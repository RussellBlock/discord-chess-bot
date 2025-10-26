# Discord Chess Game Scheduler Bot

A Discord bot that helps users schedule chess games with other players. The bot allows users to propose chess games with specific dates and times, and other players can accept these games.

## Features

- 🎮 **Chess Game Scheduling**: Propose chess games with date and time
- ⏰ **Time Validation**: Ensures games are scheduled during valid hours
- 👥 **Player Matching**: Other players can accept proposed games
- 📅 **Flexible Date Parsing**: Supports various date/time formats
- 🔔 **Notifications**: Players get DM notifications when games are confirmed/cancelled
- 🎯 **Interactive Buttons**: Easy-to-use buttons for accepting/cancelling games

## Available Times

- **Thursday-Monday**: 7:00 AM - 2:00 PM
- **Wednesday**: 7:00 AM - 12:00 PM

## Commands

- `!ping` - Test if bot is working
- `!hello` - Get a greeting
- `!help` or `!chess-help` - Show help information

## How to Propose a Game

Simply mention "chess" and "play" or "game" in your message along with a date and time.

**Examples:**
- "I want to play chess on Friday at 10 AM"
- "Chess game on 12/15/2024 at 2:00 PM"
- "Looking to play chess on Monday at 1 PM"

## Setup

### Prerequisites

- Node.js (v16 or higher)
- A Discord bot token

### Local Development

1. Clone this repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy `.env.example` to `.env` and add your Discord bot token:
   ```bash
   cp .env.example .env
   ```
4. Edit `.env` and add your Discord bot token:
   ```
   DISCORD_TOKEN=your_discord_bot_token_here
   ```
5. Run the bot:
   ```bash
   npm start
   ```

### Deploy to Railway

1. Push this repository to GitHub
2. Go to [Railway](https://railway.app)
3. Sign in with GitHub
4. Click "New Project" → "Deploy from GitHub repo"
5. Select your repository
6. Add environment variable:
   - Key: `DISCORD_TOKEN`
   - Value: Your Discord bot token
7. Deploy!

## Environment Variables

- `DISCORD_TOKEN` - Your Discord bot token (required)

## Dependencies

- `discord.js` - Discord API library
- `moment` - Date/time parsing and formatting
- `dotenv` - Environment variable management

## License

MIT