import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { google } from 'googleapis';
import fs from 'fs/promises';
import path from 'path';
import { extractAudio } from './audioExtractor.js';
import { setupTranscriptionWatcher, getTranscriptionStatus } from './transcriptionHandler.js';
import { setupTranslationWatcher, getTranslationStatus } from './translationIntegrator.js';
import { setupAudioWatcher, getAudioStatus } from './audioIntegrator.js';
import AudioSyncManager from './audioSyncManager.js';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { promisify } from 'util';
import { WebSocket, WebSocketServer } from 'ws';
import { createServer } from 'http';
import { existsSync, readdirSync } from 'fs';

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

// Store active transcription watchers
const activeWatchers = new Map();

// Function to start transcription watcher for a video
async function startTranscriptionWatcher(videoId) {
  if (!activeWatchers.has(videoId)) {
    const watcher = await setupTranscriptionWatcher(videoId);
    activeWatchers.set(videoId, watcher);
  }
}

// Store active translation watchers
const activeTranslationWatchers = new Map();

// Function to start translation watcher for a video
async function startTranslationWatcher(videoId) {
    if (!activeTranslationWatchers.has(videoId)) {
        const watcher = await setupTranslationWatcher(videoId);
        activeTranslationWatchers.set(videoId, watcher);
    }
}

// Store active audio watchers
const activeAudioWatchers = new Map();

// Function to start audio watcher for a video
async function startAudioWatcher(videoId) {
    if (!activeAudioWatchers.has(videoId)) {
        const watcher = await setupAudioWatcher(videoId);
        activeAudioWatchers.set(videoId, watcher);
    }
}

// Map to store active audio sync managers
const audioSyncManagers = new Map();

// Function to start audio sync manager for a video
async function startAudioSyncManager(videoId) {
    if (audioSyncManagers.has(videoId)) {
        console.log('Audio sync manager already running for video:', videoId);
        return;
    }

    const syncManager = new AudioSyncManager(videoId);
    audioSyncManagers.set(videoId, syncManager);
    
    // Start the sync manager
    await syncManager.start();
}

// Add this function near the top with other utility functions
async function ensureAudioDirectories(videoId) {
  const baseDir = path.join(process.cwd(), 'temp_files', videoId);
  const dirs = [
    path.join(baseDir, 'FinalTranslatedAudio'),
    path.join(baseDir, 'FinalTranslatedAudio', 'Hindi'),
    path.join(baseDir, 'FinalTranslatedAudio', 'Sanskrit'),
    path.join(baseDir, 'FinalTranslatedAudio', 'Marathi')
  ];

  for (const dir of dirs) {
    try {
      await fs.access(dir);
    } catch {
      await fs.mkdir(dir, { recursive: true });
    }
  }
}

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

      // Start transcription watcher after validation
      if (!checkOnly) {
        startTranscriptionWatcher(videoId).catch(error => {
          console.error('Error starting transcription watcher:', error);
        });
        
        // Start translation watcher after transcription watcher
        startTranslationWatcher(videoId).catch(error => {
          console.error('Error starting translation watcher:', error);
        });

        // Start audio watcher after translation watcher
        startAudioWatcher(videoId).catch(error => {
          console.error('Error starting audio watcher:', error);
        });
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

// Add endpoint to check transcription status
app.get('/api/transcription-status/:videoId', async (req, res) => {
  try {
    const { videoId } = req.params;
    const status = await getTranscriptionStatus(videoId);
    res.json(status);
  } catch (error) {
    console.error('Error getting transcription status:', error);
    res.status(500).json({ 
      error: 'Failed to get transcription status',
      details: error.message
    });
  }
});

// Add endpoint to check translation status
app.get('/api/translation-status/:videoId', async (req, res) => {
    try {
        const { videoId } = req.params;
        const status = await getTranslationStatus(videoId);
        res.json(status);
    } catch (error) {
        console.error('Error getting translation status:', error);
        res.status(500).json({ 
            error: 'Failed to get translation status',
            details: error.message
        });
    }
});

// Add new endpoint for audio generation status
app.get('/api/audio-status/:videoId', async (req, res) => {
    try {
        const { videoId } = req.params;
        
        // Ensure directories exist
        try {
            await ensureAudioDirectories(videoId);
        } catch (error) {
            console.error('Error ensuring directories exist:', error);
            // Continue even if directory creation fails
        }
        
        const status = await getAudioStatus(videoId);
        res.json(status);
    } catch (error) {
        console.error('Error getting audio status:', error);
        res.status(500).json({ error: 'Failed to get audio status' });
    }
});

// Update the existing video processing endpoint to include audio generation
app.post('/api/process-video', async (req, res) => {
    try {
        const { videoUrl } = req.body;
        
        // ... existing validation and extraction code ...

        // Start audio generation watcher after transcription is set up
        const audioWatcher = await setupAudioWatcher(videoId);
        
        res.json({
            status: 'success',
            message: 'Video processing started',
            videoId
        });
    } catch (error) {
        console.error('Error processing video:', error);
        res.status(500).json({ error: 'Failed to process video' });
    }
});

// Update the translation watcher to start audio sync after translations
activeTranslationWatchers.forEach(async (watcher, videoId) => {
    watcher.on('change', async (eventType, filename) => {
        // Start audio sync manager after translation is complete
        await startAudioSyncManager(videoId);
    });
});

// Create HTTP server
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Keep track of connected clients
const clients = new Set();

// WebSocket connection handler
wss.on('connection', (ws) => {
  clients.add(ws);
  
  ws.on('close', () => {
    clients.delete(ws);
  });
});

// Function to broadcast new fragment to all clients
function broadcastNewFragment(videoId, language, fragmentNumber) {
  const message = JSON.stringify({
    type: 'newFragment',
    videoId,
    language,
    fragment: fragmentNumber
  });
  
  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// Remove duplicate endpoints and keep only these two endpoints
app.get('/api/audio/:videoId/:language/fragments', async (req, res) => {
  const { videoId, language } = req.params;
  const languageDir = path.join(BASE_TEMP_DIR, videoId, 'FinalTranslatedAudio', language);
  
  try {
    console.log(`📂 Checking fragments in ${languageDir}`);
    
    // First ensure the directory exists
    await ensureAudioDirectories(videoId);
    
    // Check if directory exists
    const dirExists = await fs.access(languageDir)
      .then(() => true)
      .catch(() => false);
    
    if (!dirExists) {
      console.log(`❌ Directory not found: ${languageDir}`);
      return res.json({ 
        files: [],
        directory: languageDir,
        totalFiles: 0,
        audioFiles: 0
      });
    }

    // Read directory contents
    const allFiles = await fs.readdir(languageDir);
    console.log(`📁 All files in directory:`, allFiles);
    
    // Filter and sort MP3 files only
    const audioFiles = allFiles
      .filter(file => file.endsWith('.mp3'))
      .sort((a, b) => {
        const numA = parseInt(a.match(/\d+/)?.[0] || '0');
        const numB = parseInt(b.match(/\d+/)?.[0] || '0');
        return numA - numB;
      });

    console.log(`✅ Found ${audioFiles.length} MP3 fragments:`, audioFiles);
    
    res.json({
      files: audioFiles,
      directory: languageDir,
      totalFiles: allFiles.length,
      audioFiles: audioFiles.length
    });
  } catch (error) {
    console.error(`❌ Error getting fragments for ${language}:`, error);
    res.status(500).json({ 
      error: 'Failed to get fragments',
      details: error.message,
      path: languageDir
    });
  }
});

app.get('/api/audio/:videoId/:language/:filename', async (req, res) => {
  let stream;
  
  try {
    const { videoId, language, filename } = req.params;
    const audioPath = path.join(BASE_TEMP_DIR, videoId, 'FinalTranslatedAudio', language, filename);
    
    console.log('🎵 Audio request received:', {
      videoId,
      language,
      filename,
      path: audioPath
    });

    // Check if file exists
    try {
      await fs.access(audioPath);
      console.log('✅ File exists:', audioPath);
    } catch (error) {
      console.error('❌ File not found:', audioPath);
      return res.status(404).json({ error: 'Audio file not found' });
    }

    // Get file stats
    const stats = await stat(audioPath);
    if (!stats.isFile() || stats.size === 0) {
      console.error('❌ Invalid file:', audioPath);
      return res.status(404).json({ error: 'Invalid audio file' });
    }

    // Set appropriate headers
    const contentType = filename.endsWith('.mp3') ? 'audio/mpeg' : 'audio/wav';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', stats.size);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Access-Control-Allow-Origin', '*');

    // Handle range requests
    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stats.size - 1;
      const chunksize = (end - start) + 1;
      
      res.setHeader('Content-Range', `bytes ${start}-${end}/${stats.size}`);
      res.setHeader('Content-Length', chunksize);
      res.status(206);
      
      stream = createReadStream(audioPath, { start, end });
    } else {
      stream = createReadStream(audioPath);
    }

    // Handle stream events
    stream.on('error', (error) => {
      console.error('❌ Stream error:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Error streaming audio file' });
      }
    });

    stream.on('open', () => console.log('✅ Stream opened for:', filename));
    stream.on('end', () => console.log('✅ Stream ended for:', filename));

    // Pipe the stream to response
    stream.pipe(res);

  } catch (error) {
    console.error('❌ Error serving audio file:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to serve audio file' });
    }
    
    // Clean up stream if it exists
    if (stream) {
      stream.destroy();
    }
  }
});

// Add status endpoint
app.get('/api/status', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
}); 