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
const BASE_TEMP_DIR = path.join(process.cwd(), 'temp_files');

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
    const videoDir = path.join(BASE_TEMP_DIR, videoId);
    const detailsPath = path.join(videoDir, 'ytVideoDetails.json');
    
    try {
      const detailsContent = await fs.readFile(detailsPath, 'utf-8');
      return {
        details: JSON.parse(detailsContent),
        isExisting: true
      };
    } catch {
      return null;
    }
  } catch (error) {
    console.error('Error checking existing video:', error);
    return null;
  }
}

// Check if audio exists for a video
async function checkAudioExists(videoId) {
  try {
    const audioDir = path.join(BASE_TEMP_DIR, videoId, 'ExtractedAudio');
    await fs.access(audioDir);
    
    const finalDir = path.join(audioDir, 'FinalExtracted');
    const files = await fs.readdir(finalDir);
    return {
      exists: true,
      hasChunks: files.some(f => f.endsWith('.wav')),
      files: files.filter(f => f.endsWith('.wav'))
    };
  } catch {
    return { exists: false };
  }
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
            savedLocation: videoId,
            audioExtraction: extractionResult
          });
        } catch (extractionError) {
          console.error('Audio extraction error:', extractionError);
          return res.json({
            ...existingVideo.details,
            isExisting: true,
            message: 'Video details exist, but audio extraction failed',
            savedLocation: videoId,
            audioError: extractionError.message
          });
        }
      }

      // If both video and audio exist
      return res.json({
        ...existingVideo.details,
        isExisting: true,
        message: 'Video details and audio already exist',
        savedLocation: videoId,
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

      // Create directory and save video details
      const videoDir = path.join(BASE_TEMP_DIR, videoId);
      await ensureDirectoryExists(videoDir);
      const detailsPath = path.join(videoDir, 'ytVideoDetails.json');
      await fs.writeFile(detailsPath, JSON.stringify(videoInfo, null, 2));

      videoInfo.savedLocation = videoId;
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

// Add endpoint for audio extraction
app.post('/api/extract-audio', async (req, res) => {
  try {
    const { url, savedLocation } = req.body;
    
    if (!url || !savedLocation) {
      return res.status(400).json({ 
        error: 'URL and saved location are required' 
      });
    }

    // Get video details from the new location
    const videoDir = path.join(BASE_TEMP_DIR, savedLocation);
    const detailsPath = path.join(videoDir, 'ytVideoDetails.json');
    
    try {
      const detailsContent = await fs.readFile(detailsPath, 'utf-8');
      const videoDetails = JSON.parse(detailsContent);
      const isLive = videoDetails.isLiveContent;

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
    const baseDir = path.join(BASE_TEMP_DIR, savedLocation);
    const extractedAudioDir = path.join(baseDir, 'ExtractedAudio');
    const finalExtractedDir = path.join(extractedAudioDir, 'FinalExtracted');
    const preprocessingDir = path.join(extractedAudioDir, 'PreProcessing');
    
    console.log('Checking extraction status for:', { 
      savedLocation, 
      finalExtractedDir,
      preprocessingDir 
    });
    
    try {
      // Check if directories exist
      await fs.access(finalExtractedDir);
      await fs.access(preprocessingDir);
      
      // Get files from both directories
      const finalFiles = await fs.readdir(finalExtractedDir);
      const preprocessingFiles = await fs.readdir(preprocessingDir);
      
      console.log('Files found:', {
        finalExtracted: finalFiles,
        preprocessing: preprocessingFiles
      });
      
      // Check status file
      const statusPath = path.join(preprocessingDir, 'status.json');
      const hasStatusFile = preprocessingFiles.includes('status.json');
      
      if (hasStatusFile) {
        try {
          const statusContent = await fs.readFile(statusPath, 'utf-8');
          const status = JSON.parse(statusContent);
          
          // Add available files to status response
          status.availableFiles = finalFiles.filter(f => f.endsWith('.wav'));
          console.log('Sending status from file:', status);
          return res.json(status);
        } catch (err) {
          console.error('Error reading status file:', err);
        }
      }
      
      // Return list of available files
      const wavFiles = finalFiles.filter(f => f.endsWith('.wav'))
        .sort((a, b) => {
          const numA = parseInt(a.match(/fragment-(\d+)\.wav/)[1]);
          const numB = parseInt(b.match(/fragment-(\d+)\.wav/)[1]);
          return numA - numB;
        });
      
      const response = {
        status: wavFiles.length > 0 ? 'in_progress' : 'starting',
        type: 'normal',
        chunkCount: wavFiles.length,
        totalProcessing: preprocessingFiles.filter(f => f.endsWith('.wav')).length,
        latestChunk: wavFiles[wavFiles.length - 1],
        availableFiles: wavFiles
      };
      
      console.log('Sending generated status:', response);
      return res.json(response);
      
    } catch (err) {
      console.log('Directories not found, sending not_started status');
      return res.json({
        status: 'not_started',
        type: 'normal',
        chunkCount: 0,
        availableFiles: [],
        message: "Audio extraction has not been started"
      });
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