import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { google } from 'googleapis';
import fs from 'fs/promises';
import path from 'path';
import { extractAudio } from './audioExtractor.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Constants
const VIDEO_DETAILS_DIR = path.join(process.cwd(), 'temp_files', 'VideoDetailsYT');
const AUDIO_BASE_DIR = path.join(process.cwd(), 'temp_files', 'ExtractedAudio');

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
    const videoFolder = files.find(file => file === videoId);
    
    if (!videoFolder) return null;

    const detailsPath = path.join(VIDEO_DETAILS_DIR, videoFolder, 'details.json');
    const detailsContent = await fs.readFile(detailsPath, 'utf-8');
    return {
      details: JSON.parse(detailsContent),
      folderName: videoFolder,
      isExisting: true
    };
  } catch (error) {
    console.error('Error checking existing video:', error);
    return null;
  }
}

// Check if audio exists for a video
async function checkAudioExists(videoId) {
  try {
    const audioDir = path.join(AUDIO_BASE_DIR, videoId);
    await fs.access(audioDir);
    
    const files = await fs.readdir(audioDir);
    return {
      exists: true,
      hasFullAudio: files.includes('FullAudio.mp3'),
      hasChunks: files.some(f => f.startsWith('chunk_')),
      files
    };
  } catch {
    return { exists: false };
  }
}

// Save video details to JSON file
async function saveVideoDetails(videoId, details) {
  await ensureDirectoryExists(VIDEO_DETAILS_DIR);
  
  const dirName = videoId;
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
    const { url, checkOnly, liveStreamChoice } = req.body;
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    const videoId = extractVideoId(url);
    if (!videoId) {
      return res.status(400).json({ error: 'Invalid YouTube URL format' });
    }

    // Check if video already exists
    const existingVideo = await getExistingVideoDetails(videoId);
    const audioStatus = await checkAudioExists(videoId);

    if (existingVideo) {
      // If checkOnly flag is set, just return the video info
      if (checkOnly) {
        return res.json(existingVideo.details);
      }

      // If video exists but no audio, start audio extraction
      if (!audioStatus.exists) {
        try {
          const extractionResult = await extractAudio(url, videoId, existingVideo.details.isLiveContent, liveStreamChoice);
          return res.json({
            ...existingVideo.details,
            isExisting: true,
            message: 'Video details exist, started audio extraction',
            savedLocation: existingVideo.folderName,
            audioExtraction: extractionResult
          });
        } catch (extractionError) {
          console.error('Audio extraction error:', extractionError);
          return res.json({
            ...existingVideo.details,
            isExisting: true,
            message: 'Video details exist, but audio extraction failed',
            savedLocation: existingVideo.folderName,
            audioError: extractionError.message
          });
        }
      }

      // If both video and audio exist
      return res.json({
        ...existingVideo.details,
        isExisting: true,
        message: 'Video details and audio already exist',
        savedLocation: existingVideo.folderName,
        audioStatus
      });
    }

    // If video doesn't exist, proceed with new video validation and audio extraction
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

      // If checkOnly flag is set, just return the video info
      if (checkOnly) {
        return res.json(videoInfo);
      }

      // Save video details
      const { dirName } = await saveVideoDetails(videoId, videoInfo);
      videoInfo.savedLocation = dirName;
      videoInfo.isExisting = false;

      // Start audio extraction
      try {
        const extractionResult = await extractAudio(url, videoId, videoInfo.isLiveContent, liveStreamChoice);
        videoInfo.audioExtraction = extractionResult;
        videoInfo.message = 'Video details saved and audio extraction started';
      } catch (extractionError) {
        console.error('Audio extraction error:', extractionError);
        videoInfo.audioError = extractionError.message;
        videoInfo.message = 'Video details saved but audio extraction failed';
      }

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

// Add new endpoint for audio extraction
app.post('/api/extract-audio', async (req, res) => {
  try {
    const { url, savedLocation } = req.body;
    
    if (!url || !savedLocation) {
      return res.status(400).json({ 
        error: 'URL and saved location are required' 
      });
    }

    // Get video details to check if it's live
    const detailsPath = path.join(VIDEO_DETAILS_DIR, savedLocation, 'details.json');
    const detailsContent = await fs.readFile(detailsPath, 'utf-8');
    const videoDetails = JSON.parse(detailsContent);
    
    const isLive = videoDetails.isLiveContent;

    try {
      const extractionResult = await extractAudio(url, savedLocation, isLive);
      res.json({
        ...extractionResult,
        isLive,
        videoDetails: {
          title: videoDetails.title,
          channelTitle: videoDetails.channelTitle
        }
      });
    } catch (extractionError) {
      console.error('Audio extraction error:', extractionError);
      res.status(500).json({
        error: 'Failed to extract audio',
        details: extractionError.message
      });
    }
  } catch (error) {
    console.error('Error processing audio extraction request:', error);
    res.status(500).json({
      error: 'Failed to process audio extraction request',
      details: error.message
    });
  }
});

// Add endpoint to check extraction status for live streams
app.get('/api/extraction-status/:savedLocation', async (req, res) => {
  try {
    const { savedLocation } = req.params;
    const audioDir = path.join(process.cwd(), 'temp_files', 'ExtractedAudio', savedLocation);
    console.log('Checking extraction status for:', { savedLocation, audioDir });
    
    try {
      await fs.access(audioDir);
      const files = await fs.readdir(audioDir);
      console.log('Files in directory:', files);
      
      // For normal videos, check status file and FullAudio.mp3
      const statusPath = path.join(audioDir, 'status.json');
      const hasStatusFile = files.includes('status.json');
      const hasFullAudio = files.includes('FullAudio.mp3');
      
      console.log('Status check:', { 
        hasStatusFile, 
        hasFullAudio, 
        statusPath 
      });

      if (hasStatusFile) {
        try {
          const statusContent = await fs.readFile(statusPath, 'utf-8');
          const status = JSON.parse(statusContent);
          console.log('Read status file:', status);
          
          // If FullAudio.mp3 exists, ensure we show as completed
          if (hasFullAudio && status.status !== 'error') {
            const response = {
              ...status,
              status: 'completed',
              type: 'normal',
              progress: 100,
              files: ['FullAudio.mp3']
            };
            console.log('Sending completed status:', response);
            return res.json(response);
          }
          
          // Return current status for normal video download
          const response = {
            ...status,
            type: 'normal',
            files: files.filter(f => f.endsWith('.mp3'))
          };
          console.log('Sending current status:', response);
          return res.json(response);
        } catch (err) {
          console.error('Error reading status file:', err);
        }
      }
      
      // Fallback for normal videos without status file
      if (hasFullAudio) {
        const response = {
          status: 'completed',
          type: 'normal',
          progress: 100,
          files: ['FullAudio.mp3']
        };
        console.log('Sending fallback completed status:', response);
        return res.json(response);
      }
      
      // For live streams, return list of fragments
      const fragments = files
        .filter(f => f.startsWith('fragment-'))
        .sort((a, b) => {
          const numA = parseInt(a.match(/\d+/)[0]);
          const numB = parseInt(b.match(/\d+/)[0]);
          return numA - numB;
        });
      
      // Add debug logging
      console.log('Found fragments:', {
        directory: audioDir,
        allFiles: files,
        matchingFragments: fragments,
        count: fragments.length
      });
      
      const response = {
        status: 'in_progress',
        type: 'live',
        chunkCount: fragments.length,
        latestChunk: fragments[fragments.length - 1],
        fragments: fragments
      };
      console.log('Sending live status:', response);
      res.json(response);
    } catch (err) {
      if (err.code === 'ENOENT') {
        const response = {
          status: 'not_started',
          message: 'Audio extraction has not been started'
        };
        console.log('Sending not started status:', response);
        res.json(response);
      } else {
        throw err;
      }
    }
  } catch (error) {
    console.error('Error checking extraction status:', error);
    res.status(500).json({
      error: 'Failed to check extraction status',
      details: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}); 