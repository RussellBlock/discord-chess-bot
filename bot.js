const { Client, GatewayIntentBits, Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const moment = require('moment');
require('dotenv').config();

// Create a new client instance
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

// Store active chess games
const activeGames = new Map();

// Helper function to validate chess game time
function isValidChessTime(dateTime) {
    const gameMoment = moment(dateTime);
    const dayOfWeek = gameMoment.day(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
    const hour = gameMoment.hour();
    const minute = gameMoment.minute();
    const timeInMinutes = hour * 60 + minute;
    
    // Thursday (4) to Monday (1): 7 AM (420 minutes) to 2 PM (840 minutes)
    if ((dayOfWeek >= 4 || dayOfWeek <= 1) && timeInMinutes >= 420 && timeInMinutes <= 840) {
        return true;
    }
    
    // Wednesday (3): 7 AM (420 minutes) to 12 PM (720 minutes)
    if (dayOfWeek === 3 && timeInMinutes >= 420 && timeInMinutes <= 720) {
        return true;
    }
    
    return false;
}

// Helper function to parse date and time from message
function parseDateTime(message) {
    const text = message.toLowerCase();
    
    // Try to find date patterns
    const datePatterns = [
        /(?:on\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i,
        /(?:on\s+)?(\d{1,2}\/\d{1,2}\/\d{4})/,
        /(?:on\s+)?(\d{1,2}-\d{1,2}-\d{4})/,
        /(?:on\s+)?(\d{4}-\d{1,2}-\d{1,2})/
    ];
    
    // Try to find time patterns
    const timePatterns = [
        /(?:at\s+)?(\d{1,2}:\d{2}\s*(?:am|pm)?)/i,
        /(?:at\s+)?(\d{1,2}\s*(?:am|pm))/i
    ];
    
    let foundDate = null;
    let foundTime = null;
    
    // Find date
    for (const pattern of datePatterns) {
        const match = text.match(pattern);
        if (match) {
            if (match[1].match(/^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i)) {
                // Day of week - find next occurrence
                const dayName = match[1].toLowerCase();
                const dayMap = {
                    'sunday': 0, 'monday': 1, 'tuesday': 2, 'wednesday': 3,
                    'thursday': 4, 'friday': 5, 'saturday': 6
                };
                const targetDay = dayMap[dayName];
                const today = moment().day();
                let daysUntil = targetDay - today;
                if (daysUntil <= 0) daysUntil += 7;
                foundDate = moment().add(daysUntil, 'days');
            } else {
                // Date format
                foundDate = moment(match[1], ['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD', 'MM-DD-YYYY', 'DD-MM-YYYY']);
            }
            break;
        }
    }
    
    // Find time
    for (const pattern of timePatterns) {
        const match = text.match(pattern);
        if (match) {
            foundTime = moment(match[1], ['h:mm A', 'h:mm', 'h A', 'HH:mm']);
            break;
        }
    }
    
    // If no specific date found, assume today or tomorrow
    if (!foundDate) {
        foundDate = moment();
    }
    
    // If no specific time found, assume 7 AM
    if (!foundTime) {
        foundTime = moment().hour(7).minute(0);
    }
    
    // Combine date and time
    const gameDateTime = foundDate.clone()
        .hour(foundTime.hour())
        .minute(foundTime.minute())
        .second(0)
        .millisecond(0);
    
    return gameDateTime;
}

// Helper function to create game embed
function createGameEmbed(game, status = 'proposed') {
    const embed = new EmbedBuilder()
        .setTitle(`♟️ Chess Game ${status === 'proposed' ? 'Proposed' : 'Confirmed'}`)
        .setColor(status === 'proposed' ? 0xFFFF00 : 0x00FF00)
        .addFields(
            { name: 'Player 1', value: `<@${game.player1}>`, inline: true },
            { name: 'Player 2', value: game.player2 ? `<@${game.player2}>` : 'Waiting for opponent...', inline: true },
            { name: 'Date & Time', value: moment(game.dateTime).format('dddd, MMMM Do YYYY, h:mm A'), inline: false }
        )
        .setTimestamp();
    
    if (status === 'proposed') {
        embed.setDescription('A chess game has been proposed! Click the button below to accept.');
    } else {
        embed.setDescription('Chess game confirmed! Both players have been notified.');
    }
    
    return embed;
}

// When the client is ready, run this code (only once)
client.once(Events.ClientReady, readyClient => {
    console.log(`Ready! Logged in as ${readyClient.user.tag}`);
});

// Listen for messages
client.on(Events.MessageCreate, message => {
    // Ignore messages from bots
    if (message.author.bot) return;

    // Simple ping command
    if (message.content === '!ping') {
        message.reply('Pong!');
        return;
    }

    // Hello command
    if (message.content === '!hello') {
        message.reply(`Hello ${message.author.username}!`);
        return;
    }

    // Help command
    if (message.content === '!help' || message.content === '!chess-help') {
        const helpEmbed = new EmbedBuilder()
            .setTitle('♟️ Chess Game Scheduler Help')
            .setColor(0x0099FF)
            .setDescription('This bot helps you schedule chess games with other players!')
            .addFields(
                {
                    name: '📅 How to Propose a Game',
                    value: 'Simply mention "chess" and "play" or "game" in your message along with a date and time.\n\n**Examples:**\n• "I want to play chess on Friday at 10 AM"\n• "Chess game on 12/15/2024 at 2:00 PM"\n• "Looking to play chess on Monday at 1 PM"',
                    inline: false
                },
                {
                    name: '⏰ Available Times',
                    value: '• **Thursday-Monday**: 7:00 AM - 2:00 PM\n• **Wednesday**: 7:00 AM - 12:00 PM',
                    inline: false
                },
                {
                    name: '🎮 How It Works',
                    value: '1. Propose a game with a valid date/time\n2. Another player clicks "Accept Game"\n3. Both players get notified via DM\n4. Either player can cancel at any time',
                    inline: false
                },
                {
                    name: '📝 Other Commands',
                    value: '• `!ping` - Test if bot is working\n• `!hello` - Get a greeting\n• `!help` or `!chess-help` - Show this help',
                    inline: false
                }
            )
            .setTimestamp();
        
        message.reply({ embeds: [helpEmbed] });
        return;
    }

    // Chess game proposal
    if (message.content.toLowerCase().includes('chess') && 
        (message.content.toLowerCase().includes('play') || message.content.toLowerCase().includes('game'))) {
        
        try {
            const gameDateTime = parseDateTime(message.content);
            
            if (!isValidChessTime(gameDateTime)) {
                message.reply('❌ Invalid time! Chess games can only be scheduled:\n' +
                    '• Thursday-Monday: 7:00 AM - 2:00 PM\n' +
                    '• Wednesday: 7:00 AM - 12:00 PM');
                return;
            }
            
            // Check if user already has an active game
            for (const [gameId, game] of activeGames) {
                if (game.player1 === message.author.id || game.player2 === message.author.id) {
                    message.reply('❌ You already have an active chess game! Please cancel it first before proposing a new one.');
                    return;
                }
            }
            
            const gameId = `game_${Date.now()}_${message.author.id}`;
            const game = {
                id: gameId,
                player1: message.author.id,
                player2: null,
                dateTime: gameDateTime.toDate(),
                messageId: null,
                channelId: message.channel.id
            };
            
            const embed = createGameEmbed(game, 'proposed');
            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`accept_chess_${gameId}`)
                        .setLabel('Accept Game')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId(`cancel_chess_${gameId}`)
                        .setLabel('Cancel Game')
                        .setStyle(ButtonStyle.Danger)
                );
            
            message.reply({ embeds: [embed], components: [row] }).then(reply => {
                game.messageId = reply.id;
                activeGames.set(gameId, game);
            });
            
        } catch (error) {
            console.error('Error parsing chess game:', error);
            message.reply('❌ I couldn\'t understand the date/time. Please try again with a format like:\n' +
                '• "I want to play chess on Friday at 10 AM"\n' +
                '• "Chess game on 12/15/2024 at 2:00 PM"');
        }
    }
});

// Handle button interactions
client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isButton()) return;
    
    const customId = interaction.customId;
    
    if (customId.startsWith('accept_chess_')) {
        const gameId = customId.replace('accept_chess_', '');
        const game = activeGames.get(gameId);
        
        if (!game) {
            await interaction.reply({ content: '❌ This game is no longer available.', ephemeral: true });
            return;
        }
        
        if (game.player1 === interaction.user.id) {
            await interaction.reply({ content: '❌ You cannot accept your own game!', ephemeral: true });
            return;
        }
        
        if (game.player2) {
            await interaction.reply({ content: '❌ This game has already been accepted by someone else!', ephemeral: true });
            return;
        }
        
        // Check if user already has an active game
        for (const [id, existingGame] of activeGames) {
            if (existingGame.player1 === interaction.user.id || existingGame.player2 === interaction.user.id) {
                await interaction.reply({ content: '❌ You already have an active chess game! Please cancel it first.', ephemeral: true });
                return;
            }
        }
        
        game.player2 = interaction.user.id;
        
        const embed = createGameEmbed(game, 'confirmed');
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`cancel_chess_${gameId}`)
                    .setLabel('Cancel Game')
                    .setStyle(ButtonStyle.Danger)
            );
        
        await interaction.update({ embeds: [embed], components: [row] });
        
        // Notify both players
        const player1 = await client.users.fetch(game.player1);
        const player2 = await client.users.fetch(game.player2);
        
        try {
            await player1.send(`🎉 Your chess game with ${player2.username} has been confirmed for ${moment(game.dateTime).format('dddd, MMMM Do YYYY, h:mm A')}!`);
            await player2.send(`🎉 Your chess game with ${player1.username} has been confirmed for ${moment(game.dateTime).format('dddd, MMMM Do YYYY, h:mm A')}!`);
        } catch (error) {
            console.error('Error sending DM:', error);
        }
        
    } else if (customId.startsWith('cancel_chess_')) {
        const gameId = customId.replace('cancel_chess_', '');
        const game = activeGames.get(gameId);
        
        if (!game) {
            await interaction.reply({ content: '❌ This game is no longer available.', ephemeral: true });
            return;
        }
        
        if (game.player1 !== interaction.user.id && game.player2 !== interaction.user.id) {
            await interaction.reply({ content: '❌ You can only cancel games you are part of!', ephemeral: true });
            return;
        }
        
        // Notify both players if game was confirmed
        if (game.player2) {
            const player1 = await client.users.fetch(game.player1);
            const player2 = await client.users.fetch(game.player2);
            
            try {
                await player1.send(`❌ Your chess game scheduled for ${moment(game.dateTime).format('dddd, MMMM Do YYYY, h:mm A')} has been cancelled by ${interaction.user.username}.`);
                await player2.send(`❌ Your chess game scheduled for ${moment(game.dateTime).format('dddd, MMMM Do YYYY, h:mm A')} has been cancelled by ${interaction.user.username}.`);
            } catch (error) {
                console.error('Error sending DM:', error);
            }
        }
        
        // Remove game from active games
        activeGames.delete(gameId);
        
        const embed = new EmbedBuilder()
            .setTitle('♟️ Chess Game Cancelled')
            .setColor(0xFF0000)
            .setDescription('This chess game has been cancelled.')
            .setTimestamp();
        
        await interaction.update({ embeds: [embed], components: [] });
    }
});

// Log in to Discord with your client's token
client.login(process.env.DISCORD_TOKEN);
