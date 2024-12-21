import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { google } from 'googleapis';
import fs from 'fs/promises';
import path from 'path';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Constants
const VIDEO_DETAILS_DIR = path.join(process.cwd(), 'temp_files', 'VideoDetailsYT');

// Ensure directory exists
async function ensureDirectoryExists(dirPath) {
  try {
    await fs.access(dirPath);
  } catch {
    await fs.mkdir(dirPath, { recursive: true });
  }
}

// Check if video already exists and get its latest details
async function getExistingVideoDetails(videoId) {
  try {
    const files = await fs.readdir(VIDEO_DETAILS_DIR);
    const videoFolders = files.filter(file => file.includes(videoId))
      .sort((a, b) => {
        const numA = parseInt(a.split('-')[0]);
        const numB = parseInt(b.split('-')[0]);
        return numB - numA; // Sort in descending order to get latest first
      });

    if (videoFolders.length === 0) return null;

    const latestFolder = videoFolders[0];
    const detailsPath = path.join(VIDEO_DETAILS_DIR, latestFolder, 'details.json');
    const detailsContent = await fs.readFile(detailsPath, 'utf-8');
    return {
      details: JSON.parse(detailsContent),
      folderName: latestFolder,
      isExisting: true
    };
  } catch (error) {
    console.error('Error checking existing video:', error);
    return null;
  }
}

// Find next available number for video ID
async function findNextNumberForVideo(videoId) {
  try {
    const files = await fs.readdir(VIDEO_DETAILS_DIR);
    const existingNumbers = files
      .filter(file => file.includes(videoId))
      .map(file => parseInt(file.split('-')[0]))
      .filter(num => !isNaN(num));

    if (existingNumbers.length === 0) return 1;
    return Math.max(...existingNumbers) + 1;
  } catch {
    return 1;
  }
}

// Save video details to JSON file
async function saveVideoDetails(videoId, details) {
  await ensureDirectoryExists(VIDEO_DETAILS_DIR);
  
  const nextNumber = await findNextNumberForVideo(videoId);
  const dirName = `${nextNumber}-${videoId}`;
  const dirPath = path.join(VIDEO_DETAILS_DIR, dirName);
  
  await ensureDirectoryExists(dirPath);
  
  const filePath = path.join(dirPath, 'details.json');
  await fs.writeFile(filePath, JSON.stringify(details, null, 2));
  
  return { dirName, filePath };
}

// Validate YouTube API key
if (!process.env.YOUTUBE_API_KEY) {
  console.error('YouTube API key is not configured. Please set YOUTUBE_API_KEY in .env file');
  process.exit(1);
}

// YouTube API setup
const youtube = google.youtube({
  version: 'v3',
  auth: process.env.YOUTUBE_API_KEY
});

// Utility function to extract video ID from URL
const extractVideoId = (url) => {
  const patterns = [
    /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i,
    /^[a-zA-Z0-9_-]{11}$/
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
};

// Validate YouTube URL and get video information
app.post('/api/validate-youtube', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    const videoId = extractVideoId(url);
    if (!videoId) {
      return res.status(400).json({ error: 'Invalid YouTube URL format' });
    }

    // Check if video already exists
    const existingVideo = await getExistingVideoDetails(videoId);
    if (existingVideo) {
      return res.json({
        ...existingVideo.details,
        isExisting: true,
        message: 'Video details already exist in the system',
        savedLocation: existingVideo.folderName
      });
    }

    try {
      const response = await youtube.videos.list({
        part: ['snippet', 'contentDetails', 'status', 'liveStreamingDetails'],
        id: [videoId]
      });

      if (!response.data.items || response.data.items.length === 0) {
        return res.status(404).json({ error: 'Video not found' });
      }

      const video = response.data.items[0];
      const videoInfo = {
        id: video.id,
        title: video.snippet.title,
        description: video.snippet.description,
        channelTitle: video.snippet.channelTitle,
        channelId: video.snippet.channelId,
        thumbnails: video.snippet.thumbnails,
        duration: video.contentDetails.duration,
        privacyStatus: video.status.privacyStatus,
        isLiveContent: video.snippet.liveBroadcastContent !== 'none',
        liveStreamingDetails: video.liveStreamingDetails || null,
        savedAt: new Date().toISOString(),
        rawApiResponse: response.data
      };

      // Save video details to file
      const { dirName } = await saveVideoDetails(videoId, videoInfo);
      
      // Add file location to response
      videoInfo.savedLocation = dirName;
      videoInfo.isExisting = false;

      res.json(videoInfo);
    } catch (youtubeError) {
      console.error('YouTube API Error:', youtubeError.message);
      if (youtubeError.code === 403) {
        return res.status(403).json({ 
          error: 'YouTube API authentication failed. Please check your API key.',
          details: youtubeError.message
        });
      }
      throw youtubeError;
    }
  } catch (error) {
    console.error('Error validating YouTube URL:', error);
    res.status(500).json({ 
      error: 'Failed to validate YouTube URL',
      details: error.message
    });
  }
});

// Get list of saved video details
app.get('/api/saved-videos', async (req, res) => {
  try {
    await ensureDirectoryExists(VIDEO_DETAILS_DIR);
    const files = await fs.readdir(VIDEO_DETAILS_DIR);
    
    // Get details for each saved video
    const videosDetails = await Promise.all(
      files.map(async (folder) => {
        try {
          const detailsPath = path.join(VIDEO_DETAILS_DIR, folder, 'details.json');
          const content = await fs.readFile(detailsPath, 'utf-8');
          const details = JSON.parse(content);
          return {
            folder,
            id: details.id,
            title: details.title,
            savedAt: details.savedAt
          };
        } catch {
          return null;
        }
      })
    );

    res.json({ 
      savedVideos: videosDetails.filter(Boolean)
        .sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt))
    });
  } catch (error) {
    console.error('Error getting saved videos:', error);
    res.status(500).json({ error: 'Failed to get saved videos' });
  }
});

// Get specific video details
app.get('/api/video/:videoId', async (req, res) => {
  try {
    const { videoId } = req.params;
    const existingVideo = await getExistingVideoDetails(videoId);
    
    if (!existingVideo) {
      return res.status(404).json({ error: 'Video details not found' });
    }

    res.json(existingVideo.details);
  } catch (error) {
    console.error('Error getting video details:', error);
    res.status(500).json({ error: 'Failed to get video details' });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}); 