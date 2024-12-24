import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs/promises';
import path from 'path';
import { createWriteStream } from 'fs';
import { spawn } from 'child_process';
import { open } from 'fs/promises';  // For file lock checking

// Update base directory constant
const BASE_TEMP_DIR = path.join(process.cwd(), 'temp_files');

// Ensure directory exists
async function ensureDirectoryExists(dirPath) {
  try {
    await fs.access(dirPath);
  } catch {
    await fs.mkdir(dirPath, { recursive: true });
  }
}

// Create video directory structure
async function createVideoDirectoryStructure(videoId) {
  const videoDir = path.join(BASE_TEMP_DIR, videoId);
  const extractedAudioDir = path.join(videoDir, 'ExtractedAudio');
  const preprocessingDir = path.join(extractedAudioDir, 'PreProcessing');
  const finalExtractedDir = path.join(extractedAudioDir, 'FinalExtracted');

  await ensureDirectoryExists(videoDir);
  await ensureDirectoryExists(extractedAudioDir);
  await ensureDirectoryExists(preprocessingDir);
  await ensureDirectoryExists(finalExtractedDir);

  return {
    videoDir,
    extractedAudioDir,
    preprocessingDir,
    finalExtractedDir
  };
}

// Save video details
async function saveVideoDetails(videoId, details) {
  const videoDir = path.join(BASE_TEMP_DIR, videoId);
  await ensureDirectoryExists(videoDir);
  const detailsPath = path.join(videoDir, 'ytVideoDetails.json');
  await fs.writeFile(detailsPath, JSON.stringify(details, null, 2));
}

// Get video information
async function getVideoInfo(url) {
  return new Promise((resolve, reject) => {
    let output = '';
    let error = '';
    let timeout;

    const process = spawn('yt-dlp', [
      '--dump-json',
      '--no-warnings',
      '--no-call-home',
      '--prefer-free-formats',
      url
    ]);

    // Set a timeout of 30 seconds
    timeout = setTimeout(() => {
      process.kill();
      reject(new Error('Timeout while getting video information'));
    }, 30000);

    process.stdout.on('data', (data) => {
      output += data.toString();
    });

    process.stderr.on('data', (data) => {
      error += data.toString();
    });

    process.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0 && output) {
        try {
          const info = JSON.parse(output);
          if (!info) {
            reject(new Error('No video information returned'));
            return;
          }
          if (!info.title) {
            console.error('Video info received:', info);
            reject(new Error('Video information is incomplete (missing title)'));
            return;
          }
          resolve(info);
        } catch (e) {
          console.error('Error parsing video info:', e);
          reject(new Error(`Failed to parse video information: ${e.message}`));
        }
      } else {
        console.error('Error getting video info. Code:', code);
        console.error('Error output:', error);
        console.error('URL attempted:', url);
        reject(new Error(`Failed to get video information: ${error || 'Unknown error'}`));
      }
    });

    process.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`Failed to start video info process: ${err.message}`));
    });
  });
}

// Extract audio from normal video
async function extractNormalAudio(videoUrl, videoId) {
  return new Promise(async (resolve, reject) => {
    try {
      console.log('Starting audio extraction...');
      
      // Create directory structure
      const { preprocessingDir, finalExtractedDir } = await createVideoDirectoryStructure(videoId);
      const statusPath = path.join(preprocessingDir, 'status.json');
      
      // Use fragment-N naming for consistency
      const preprocessingTemplate = path.join(preprocessingDir, 'fragment-%d.wav');
      
      // Initialize status file
      const initialStatus = {
        status: 'starting',
        progress: 0,
        startTime: new Date().toISOString()
      };
      await fs.writeFile(statusPath, JSON.stringify(initialStatus));
      
      // First step: Extract audio using yt-dlp and pipe to ffmpeg for segmentation
      const ytdlProcess = spawn('yt-dlp', [
        '--format', 'bestaudio',
        '--no-warnings',
        '--no-call-home',
        '--prefer-free-formats',
        '--no-playlist',
        '-o', '-',  // Output to stdout
        videoUrl
      ]);

      // Second step: Use ffmpeg to segment the audio
      const ffmpegProcess = spawn('ffmpeg', [
        '-i', 'pipe:0',        // Read from stdin
        '-f', 'segment',       // Enable segmentation
        '-segment_time', '20', // 20 seconds per segment
        '-reset_timestamps', '1',
        '-acodec', 'pcm_s16le', // LINEAR16 encoding
        '-ar', '16000',         // 16 kHz sample rate
        '-ac', '1',             // Mono channel
        '-map', '0:a',          // Only process audio
        preprocessingTemplate   // Output to preprocessing directory
      ]);

      // Pipe yt-dlp output to ffmpeg
      ytdlProcess.stdout.pipe(ffmpegProcess.stdin);

      let error = '';
      let currentFragment = 0;
      let lastProgressTime = Date.now();

      // Monitor ffmpeg output for segment completion
      ffmpegProcess.stderr.on('data', async (data) => {
        const output = data.toString();
        console.log('FFmpeg output:', output);
        lastProgressTime = Date.now();

        // Check for segment completion message
        if (output.includes('Opening')) {
          // Previous fragment is complete, check and move it
          const previousFragment = currentFragment - 1;
          if (previousFragment >= 0) {
            const fragmentName = `fragment-${previousFragment}.wav`;
            const preprocessingPath = path.join(preprocessingDir, fragmentName);
            const finalPath = path.join(finalExtractedDir, fragmentName);
            
            try {
              // Check if file exists and is not locked
              const locked = await isFileLocked(preprocessingPath);
              if (!locked) {
                // Copy to FinalExtracted
                await fs.copyFile(preprocessingPath, finalPath);
                console.log(`Moved fragment ${fragmentName} to FinalExtracted`);
                
                // Update status with progress
                const progressStatus = {
                  status: 'processing',
                  progress: Math.min(95, (currentFragment / 20) * 100),
                  currentFragment: currentFragment,
                  lastUpdate: new Date().toISOString()
                };
                await fs.writeFile(statusPath, JSON.stringify(progressStatus));
              }
            } catch (error) {
              console.error('Error checking/moving fragment:', error);
            }
          }
          currentFragment++;
        }
      });

      // Handle yt-dlp errors
      ytdlProcess.stderr.on('data', (data) => {
        const errorStr = data.toString();
        error += errorStr;
        console.error('Extraction error:', errorStr);
      });

      // Handle process completion
      ytdlProcess.on('close', async (code) => {
        if (code !== 0) {
          const errorMsg = `YouTube-DL process failed with code ${code}: ${error}`;
          console.error(errorMsg);
          
          // Update status file with error
          const errorStatus = {
            status: 'error',
            error: errorMsg,
            errorTime: new Date().toISOString()
          };
          await fs.writeFile(statusPath, JSON.stringify(errorStatus));
          
          reject(new Error(errorMsg));
          return;
        }
      });

      ffmpegProcess.on('close', async (code) => {
        if (code === 0) {
          console.log('Audio extraction and segmentation completed successfully');
          
          try {
            // Move the last fragment if it exists
            if (currentFragment > 0) {
              const lastFragmentName = `fragment-${currentFragment - 1}.wav`;
              const lastPreprocessingPath = path.join(preprocessingDir, lastFragmentName);
              const lastFinalPath = path.join(finalExtractedDir, lastFragmentName);
              
              try {
                const locked = await isFileLocked(lastPreprocessingPath);
                if (!locked) {
                  await fs.copyFile(lastPreprocessingPath, lastFinalPath);
                  console.log(`Moved final fragment ${lastFragmentName} to FinalExtracted`);
                }
              } catch (error) {
                console.error(`Error moving final fragment ${lastFragmentName}:`, error);
              }
            }
            
            // Update status file with completion
            const completionStatus = {
              status: 'completed',
              progress: 100,
              completionTime: new Date().toISOString(),
              totalFragments: currentFragment
            };
            
            await fs.writeFile(statusPath, JSON.stringify(completionStatus));
            
            resolve({
              status: 'completed',
              outputDir: finalExtractedDir,
              message: 'Audio extraction completed successfully',
              totalFragments: currentFragment
            });
          } catch (error) {
            console.error('Error in completion handling:', error);
            reject(error);
          }
        } else {
          const errorMsg = `FFmpeg process failed with code ${code}`;
          console.error(errorMsg);
          
          // Update status file with error
          const errorStatus = {
            status: 'error',
            error: errorMsg,
            errorTime: new Date().toISOString()
          };
          await fs.writeFile(statusPath, JSON.stringify(errorStatus));
          
          reject(new Error(errorMsg));
        }
      });

    } catch (error) {
      console.error('Error in audio extraction:', error);
      
      // Update status file with error
      const errorStatus = {
        status: 'error',
        error: error.message,
        errorTime: new Date().toISOString()
      };
      
      try {
        await fs.writeFile(statusPath, JSON.stringify(errorStatus));
      } catch (err) {
        console.error('Error updating error status:', err);
      }
      
      reject(error);
    }
  });
}

// Check if file is locked (being written to)
async function isFileLocked(filePath) {
  try {
    // First check if file exists
    await fs.access(filePath);
    
    // Get file stats to ensure it has content
    const stats = await fs.stat(filePath);
    if (stats.size === 0) {
      return true; // Consider empty files as locked
    }

    // Try to open the file for reading
    const fileHandle = await open(filePath, 'r');
    await fileHandle.close();
    return false;  // File is not locked
  } catch (error) {
    if (error.code === 'ENOENT') {
      return true; // File doesn't exist yet
    }
    if (error.code === 'EBUSY' || error.code === 'EPERM') {
      return true; // File is locked
    }
    console.error('Error checking file lock:', error);
    return true; // Assume locked on any error
  }
}

// Extract audio chunks for live stream
async function extractLiveAudioChunks(videoUrl, outputDir, liveStreamChoice) {
  return new Promise(async (resolve, reject) => {
    let process;
    let isShuttingDown = false;
    let currentFragment = 0;

    try {
      console.log('Starting live stream audio extraction...');
      
      // Create directory structure
      const preprocessingDir = path.join(outputDir, 'PreProcessing');
      const finalExtractedDir = path.join(outputDir, 'FinalExtracted');
      await fs.mkdir(preprocessingDir, { recursive: true });
      await fs.mkdir(finalExtractedDir, { recursive: true });
      
      // Use fragment-N naming for output with WAV format
      const preprocessingTemplate = path.join(preprocessingDir, 'fragment-%d.wav');
      
      // Base command arguments
      const ytdlpArgs = [
        '--format', 'bestaudio',
        '--no-warnings',
        '--no-call-home',
        '--prefer-free-formats',
        '--no-playlist',
        '--fragment-retries', '3',
        '--retries', '3',
        '--force-overwrites',
        '-o', '-'  // Output to stdout
      ];

      if (liveStreamChoice === 'beginning') {
        ytdlpArgs.push('--live-from-start');
      }

      ytdlpArgs.push(videoUrl);
      process = spawn('yt-dlp', ytdlpArgs);

      let ffmpegProcess = spawn('ffmpeg', [
        '-i', 'pipe:0',        // Read from stdin
        '-f', 'segment',       // Enable segmentation
        '-segment_time', '20', // 20 seconds per segment
        '-reset_timestamps', '1',
        '-acodec', 'pcm_s16le', // LINEAR16 encoding
        '-ar', '16000',         // 16 kHz sample rate
        '-ac', '1',             // Mono channel
        '-map', '0:a',          // Only process audio
        preprocessingTemplate   // Output to preprocessing directory
      ]);

      // Pipe yt-dlp output to ffmpeg
      process.stdout.pipe(ffmpegProcess.stdin);

      // Monitor ffmpeg output for segment completion
      ffmpegProcess.stderr.on('data', async (data) => {
        const output = data.toString();
        console.log('FFmpeg output:', output);

        // Check for segment completion message
        if (output.includes('Opening')) {
          // Previous fragment is complete, check and move it
          const previousFragment = currentFragment - 1;
          if (previousFragment >= 0) {
            const fragmentName = `fragment-${previousFragment}.wav`;
            const preprocessingPath = path.join(preprocessingDir, fragmentName);
            const finalPath = path.join(finalExtractedDir, fragmentName);
            
            try {
              // Check if file exists and is not locked
              const locked = await isFileLocked(preprocessingPath);
              if (!locked) {
                // Copy to FinalExtracted
                await fs.copyFile(preprocessingPath, finalPath);
                console.log(`Moved fragment ${fragmentName} to FinalExtracted`);
              }
            } catch (error) {
              console.error('Error checking/moving fragment:', error);
            }
          }
          currentFragment++;
        }
      });

      // Handle yt-dlp errors
      process.stderr.on('data', (data) => {
        const errorStr = data.toString();
        console.error('Live stream error:', errorStr);
      });

      // Resolve immediately for live streams as it's an ongoing process
      resolve({
        status: 'started',
        outputDir: finalExtractedDir,
        preprocessingDir,
        message: 'Live audio extraction started in fragments',
        type: 'live',
        format: {
          codec: 'LINEAR16',
          sampleRate: '16kHz',
          bitDepth: '16-bit',
          channels: 'mono'
        },
        stop: () => {
          isShuttingDown = true;
          if (process) process.kill();
          if (ffmpegProcess) ffmpegProcess.kill();
        }
      });

      // Handle process completion and errors
      process.on('close', (code) => {
        if (code !== 0 && !isShuttingDown) {
          console.error('Live stream extraction ended with error');
          console.log('Attempting to restart stream extraction...');
          setTimeout(() => {
            extractLiveAudioChunks(videoUrl, outputDir, liveStreamChoice)
              .catch(err => console.error('Failed to restart stream:', err));
          }, 5000);
        }
      });

      process.on('error', (err) => {
        console.error('Live stream process error:', err);
        if (!isShuttingDown) {
          setTimeout(() => {
            extractLiveAudioChunks(videoUrl, outputDir, liveStreamChoice)
              .catch(err => console.error('Failed to restart stream:', err));
          }, 5000);
        }
      });

      ffmpegProcess.on('close', (code) => {
        if (code !== 0 && !isShuttingDown) {
          console.error('FFmpeg process ended with error code:', code);
        }
      });

    } catch (error) {
      console.error('Error setting up live stream extraction:', error);
      reject(error);
    }
  });
}

// Extract audio from video (main function)
async function extractAudio(videoUrl, videoId, isLive, liveStreamChoice) {
  try {
    // Get video info first
    const info = await getVideoInfo(videoUrl);
    console.log('Video info retrieved:', {
      title: info.title,
      duration: info.duration,
      isLive: info._type === 'live' || info.is_live
    });

    // Create directory structure and save video details
    const { videoDir } = await createVideoDirectoryStructure(videoId);
    const detailsPath = path.join(videoDir, 'ytVideoDetails.json');
    await fs.writeFile(detailsPath, JSON.stringify(info, null, 2));

    // If it's a live stream
    if (isLive) {
      if (!liveStreamChoice) {
        throw new Error('Live stream choice is required for live content');
      }
      const { extractedAudioDir } = await createVideoDirectoryStructure(videoId);
      return extractLiveAudioChunks(videoUrl, extractedAudioDir, liveStreamChoice);
    }

    // For normal videos
    return extractNormalAudio(videoUrl, videoId);
  } catch (error) {
    console.error('Error in extractAudio:', error);
    throw error;
  }
}

export { extractAudio }; 