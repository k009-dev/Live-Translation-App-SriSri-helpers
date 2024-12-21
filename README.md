# YouTube Video Validator

A web application that validates YouTube URLs and displays comprehensive video information using the YouTube Data API.

## Features

- Validates YouTube URLs (both regular videos and live streams)
- Displays video metadata:
  - Title and description
  - Channel information
  - Thumbnail preview
  - Stream status (live/upcoming/normal)
  - Stream timing details
  - Video duration
  - Privacy status

## Prerequisites

- Node.js (v16 or higher)
- YouTube Data API key

## Setup

1. Clone the repository:
```bash
git clone <repository-url>
cd youtube-video-validator
```

2. Install dependencies:
```bash
npm run install-all
```

3. Configure environment variables:
```bash
# In the backend directory
cp .env.example .env
```
Edit the `.env` file and add your YouTube Data API key:
```
YOUTUBE_API_KEY=your_youtube_api_key_here
```

## Development

Start both frontend and backend in development mode:

```bash
npm run dev
```

This will start:
- Frontend at http://localhost:5173
- Backend at http://localhost:3001

## Project Structure

```
.
├── frontend/           # React frontend application
│   ├── src/           # Source files
│   └── ...
├── backend/           # Express backend server
│   ├── src/          # Source files
│   └── ...
└── package.json      # Root package.json for running both services
```

## API Endpoints

### POST /api/validate-youtube
Validates a YouTube URL and returns video information.

Request body:
```json
{
  "url": "https://www.youtube.com/watch?v=VIDEO_ID"
}
```

## Technologies Used

- Frontend:
  - React
  - Vite
  - Tailwind CSS
  - Axios
  - React Hot Toast

- Backend:
  - Express
  - YouTube Data API
  - CORS
  - dotenv 