const { Client, GatewayIntentBits, Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const moment = require('moment');
const fs = require('fs').promises;
const path = require('path');
const { execSync } = require('child_process');
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

// ELO storage file path
const ELO_FILE = path.join(__dirname, 'elo_ratings.json');
const DEFAULT_ELO = 1500;
const K_FACTOR = 32; // Standard chess K-factor

// Changelog tracking
const LAST_COMMIT_FILE = path.join(__dirname, '.last_commit');

// Load ELO ratings from file
async function loadELORatings() {
    try {
        const data = await fs.readFile(ELO_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        // File doesn't exist, return empty object
        return {};
    }
}

// Save ELO ratings to file
async function saveELORatings(ratings) {
    await fs.writeFile(ELO_FILE, JSON.stringify(ratings, null, 2), 'utf8');
}

// Get player's ELO rating
async function getELO(playerId) {
    const ratings = await loadELORatings();
    return ratings[playerId] || DEFAULT_ELO;
}

// Calculate rank based on ELO
function calculateRank(elo) {
    if (elo >= 2000) return 'Grandmaster';
    if (elo >= 1800) return 'Master';
    if (elo >= 1600) return 'Expert';
    if (elo >= 1400) return 'Advanced';
    if (elo >= 1200) return 'Intermediate';
    return 'Beginner';
}

// Calculate expected score (probability of winning)
function calculateExpectedScore(playerRating, opponentRating) {
    return 1 / (1 + Math.pow(10, (opponentRating - playerRating) / 400));
}

// Calculate new ELO rating
function calculateNewRating(oldRating, expectedScore, actualScore) {
    return Math.round(oldRating + K_FACTOR * (actualScore - expectedScore));
}

// Update ELO ratings after a game
async function updateELO(player1Id, player2Id, player1Score, player2Score) {
    const ratings = await loadELORatings();
    
    // Get current ratings
    const player1Rating = ratings[player1Id] || DEFAULT_ELO;
    const player2Rating = ratings[player2Id] || DEFAULT_ELO;
    
    // Calculate expected scores
    const player1Expected = calculateExpectedScore(player1Rating, player2Rating);
    const player2Expected = calculateExpectedScore(player2Rating, player1Rating);
    
    // Calculate new ratings
    const player1New = calculateNewRating(player1Rating, player1Expected, player1Score);
    const player2New = calculateNewRating(player2Rating, player2Expected, player2Score);
    
    // Update ratings
    ratings[player1Id] = player1New;
    ratings[player2Id] = player2New;
    
    // Save to file
    await saveELORatings(ratings);
    
    return {
        player1: { old: player1Rating, new: player1New, change: player1New - player1Rating },
        player2: { old: player2Rating, new: player2New, change: player2New - player2Rating }
    };
}

// Get last known commit hash
async function getLastCommit() {
    try {
        const data = await fs.readFile(LAST_COMMIT_FILE, 'utf8');
        return data.trim();
    } catch (error) {
        return null;
    }
}

// Save last known commit hash
async function saveLastCommit(commitHash) {
    await fs.writeFile(LAST_COMMIT_FILE, commitHash, 'utf8');
}

// Get current commit hash
function getCurrentCommit() {
    try {
        return execSync('git rev-parse HEAD', { encoding: 'utf8', cwd: __dirname }).trim();
    } catch (error) {
        return null;
    }
}

// Get git log since a commit
function getGitLogSince(lastCommit) {
    try {
        if (!lastCommit) {
            // Get last 5 commits if no last commit
            return execSync('git log --oneline -5', { encoding: 'utf8', cwd: __dirname }).trim();
        }
        return execSync(`git log --oneline ${lastCommit}..HEAD`, { encoding: 'utf8', cwd: __dirname }).trim();
    } catch (error) {
        return null;
    }
}

// Summarize git commits
function summarizeCommits(logText) {
    if (!logText || logText.trim() === '') return null;
    
    const commits = logText.split('\n').filter(line => line.trim());
    if (commits.length === 0) return null;
    
    const summary = [];
    summary.push(`**${commits.length} new commit${commits.length > 1 ? 's' : ''} detected:**\n`);
    
    commits.forEach((commit, index) => {
        const [hash, ...messageParts] = commit.split(' ');
        const message = messageParts.join(' ');
        summary.push(`• ${message}`);
    });
    
    return summary.join('\n');
}

// Post changelog to Discord
async function postChangelog(client) {
    const changelogChannelId = process.env.CHANGELOG_CHANNEL_ID;
    
    if (!changelogChannelId) {
        console.log('No CHANGELOG_CHANNEL_ID set, skipping changelog post');
        return;
    }
    
    try {
        const lastCommit = await getLastCommit();
        const currentCommit = getCurrentCommit();
        
        if (!currentCommit) {
            console.log('Could not get current commit, skipping changelog');
            return;
        }
        
        // If no last commit or commits are different
        if (!lastCommit || lastCommit !== currentCommit) {
            const logText = getGitLogSince(lastCommit);
            const summary = summarizeCommits(logText);
            
            if (summary) {
                const channel = await client.channels.fetch(changelogChannelId);
                const embed = new EmbedBuilder()
                    .setTitle('🔄 Bot Updated')
                    .setColor(0x00FF00)
                    .setDescription(summary)
                    .setTimestamp();
                
                await channel.send({ embeds: [embed] });
                console.log('Posted changelog to Discord');
            }
            
            // Save current commit
            await saveLastCommit(currentCommit);
        }
    } catch (error) {
        console.error('Error posting changelog:', error);
    }
}

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
client.once(Events.ClientReady, async readyClient => {
    console.log(`Ready! Logged in as ${readyClient.user.tag}`);
    
    // Post changelog if there are updates
    await postChangelog(readyClient);
});

// Listen for messages
client.on(Events.MessageCreate, async message => {
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
                    name: '📝 Commands',
                    value: '• `!ping` - Test if bot is working\n• `!hello` - Get a greeting\n• `!cancel-game` or `!cancel-chess` - Cancel your active chess game\n• `!report-result <opponent> <win/loss/draw>` - Report game result\n• `!elo [player]` - View ELO rating\n• `!leaderboard` - View top players\n• `!help` or `!chess-help` - Show this help',
                    inline: false
                }
            )
            .setTimestamp();
        
        message.reply({ embeds: [helpEmbed] });
        return;
    }

    // Cancel game command
    if (message.content === '!cancel-game' || message.content === '!cancel-chess') {
        let foundGame = null;
        let foundGameId = null;
        
        // Find user's active game
        for (const [gameId, game] of activeGames) {
            if (game.player1 === message.author.id || game.player2 === message.author.id) {
                foundGame = game;
                foundGameId = gameId;
                break;
            }
        }
        
        if (!foundGame) {
            message.reply('❌ You don\'t have any active chess games to cancel.');
            return;
        }
        
        // Notify both players if game was confirmed
        if (foundGame.player2) {
            const player1 = await client.users.fetch(foundGame.player1);
            const player2 = await client.users.fetch(foundGame.player2);
            
            try {
                await player1.send(`❌ Your chess game scheduled for ${moment(foundGame.dateTime).format('dddd, MMMM Do YYYY, h:mm A')} has been cancelled by ${message.author.username}.`);
                await player2.send(`❌ Your chess game scheduled for ${moment(foundGame.dateTime).format('dddd, MMMM Do YYYY, h:mm A')} has been cancelled by ${message.author.username}.`);
            } catch (error) {
                console.error('Error sending DM:', error);
            }
        }
        
        // Try to update the original message if it still exists
        try {
            const channel = await client.channels.fetch(foundGame.channelId);
            if (foundGame.messageId) {
                const gameMessage = await channel.messages.fetch(foundGame.messageId);
                const embed = new EmbedBuilder()
                    .setTitle('♟️ Chess Game Cancelled')
                    .setColor(0xFF0000)
                    .setDescription('This chess game has been cancelled.')
                    .setTimestamp();
                await gameMessage.edit({ embeds: [embed], components: [] });
            }
        } catch (error) {
            // Message might have been deleted, that's okay
            console.log('Original game message not found (may have been deleted)');
        }
        
        // Remove game from active games
        activeGames.delete(foundGameId);
        
        message.reply('✅ Your chess game has been cancelled.');
        return;
    }

    // Report result command
    if (message.content.startsWith('!report-result') || message.content.startsWith('!report')) {
        const args = message.content.split(/\s+/);
        
        if (args.length < 3) {
            message.reply('❌ Usage: `!report-result <@opponent> <win/loss/draw>`\n\n**Examples:**\n• `!report-result @player win`\n• `!report-result @player loss`\n• `!report-result @player draw`');
            return;
        }
        
        // Extract opponent mention
        const opponentMatch = message.mentions.users.first();
        if (!opponentMatch) {
            message.reply('❌ Please mention your opponent. Example: `!report-result @player win`');
            return;
        }
        
        if (opponentMatch.id === message.author.id) {
            message.reply('❌ You cannot report a result against yourself!');
            return;
        }
        
        // Parse result
        const result = args[args.length - 1].toLowerCase();
        let player1Score, player2Score;
        
        if (result === 'win' || result === 'w') {
            player1Score = 1;
            player2Score = 0;
        } else if (result === 'loss' || result === 'l' || result === 'lose') {
            player1Score = 0;
            player2Score = 1;
        } else if (result === 'draw' || result === 'd' || result === 'tie') {
            player1Score = 0.5;
            player2Score = 0.5;
        } else {
            message.reply('❌ Invalid result! Use `win`, `loss`, or `draw`.');
            return;
        }
        
        // Update ELO
        const eloUpdate = await updateELO(message.author.id, opponentMatch.id, player1Score, player2Score);
        
        // Create result embed
        const resultEmbed = new EmbedBuilder()
            .setTitle('♟️ Game Result Reported')
            .setColor(0x0099FF)
            .addFields(
                { name: 'Player 1', value: `<@${message.author.id}>`, inline: true },
                { name: 'Player 2', value: `<@${opponentMatch.id}>`, inline: true },
                { name: 'Result', value: result === 'win' || result === 'w' ? `${message.author.username} won!` : result === 'loss' || result === 'l' || result === 'lose' ? `${opponentMatch.username} won!` : 'Draw', inline: false },
                { 
                    name: 'ELO Changes', 
                    value: `<@${message.author.id}>: ${eloUpdate.player1.old} → ${eloUpdate.player1.new} (${eloUpdate.player1.change >= 0 ? '+' : ''}${eloUpdate.player1.change})\n<@${opponentMatch.id}>: ${eloUpdate.player2.old} → ${eloUpdate.player2.new} (${eloUpdate.player2.change >= 0 ? '+' : ''}${eloUpdate.player2.change})`,
                    inline: false
                }
            )
            .setTimestamp();
        
        message.reply({ embeds: [resultEmbed] });
        return;
    }

    // View ELO command
    if (message.content.startsWith('!elo') || message.content.startsWith('!rating')) {
        const args = message.content.split(/\s+/);
        let targetUser = message.author;
        
        // Check if a user was mentioned
        if (message.mentions.users.size > 0) {
            targetUser = message.mentions.users.first();
        } else if (args.length > 1) {
            // Try to get user by ID if provided
            try {
                targetUser = await client.users.fetch(args[1]);
            } catch (error) {
                // Invalid user ID, use author
            }
        }
        
        const elo = await getELO(targetUser.id);
        
        const eloEmbed = new EmbedBuilder()
            .setTitle(`♟️ ELO Rating: ${targetUser.username}`)
            .setColor(0x0099FF)
            .addFields(
                { name: 'Rating', value: `${elo}`, inline: true },
                { name: 'Rank', value: calculateRank(elo), inline: true }
            )
            .setThumbnail(targetUser.displayAvatarURL())
            .setTimestamp();
        
        message.reply({ embeds: [eloEmbed] });
        return;
    }

    // Leaderboard command
    if (message.content === '!leaderboard' || message.content === '!lb') {
        const ratings = await loadELORatings();
        
        // Convert to array and sort
        const sortedPlayers = Object.entries(ratings)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10); // Top 10
        
        if (sortedPlayers.length === 0) {
            message.reply('📊 No ratings yet! Play some games and report results to see the leaderboard.');
            return;
        }
        
        // Build leaderboard text
        let leaderboardText = '';
        for (let i = 0; i < sortedPlayers.length; i++) {
            const [playerId, rating] = sortedPlayers[i];
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
            
            try {
                const user = await client.users.fetch(playerId);
                leaderboardText += `${medal} <@${playerId}> - **${rating}** ELO\n`;
            } catch (error) {
                leaderboardText += `${medal} <@${playerId}> - **${rating}** ELO\n`;
            }
        }
        
        const leaderboardEmbed = new EmbedBuilder()
            .setTitle('🏆 Chess Leaderboard')
            .setColor(0xFFD700)
            .setDescription(leaderboardText)
            .setTimestamp();
        
        message.reply({ embeds: [leaderboardEmbed] });
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
