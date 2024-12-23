import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs/promises';
import path from 'path';
import { createWriteStream } from 'fs';
import { spawn } from 'child_process';

const AUDIO_BASE_DIR = path.join(process.cwd(), 'temp_files', 'ExtractedAudio');

// Ensure directory exists
async function ensureDirectoryExists(dirPath) {
  try {
    await fs.access(dirPath);
  } catch {
    await fs.mkdir(dirPath, { recursive: true });
  }
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
async function extractNormalAudio(videoUrl, outputDir) {
  return new Promise(async (resolve, reject) => {
    const tempOutputPath = path.join(outputDir, 'temp_audio.wav');
    const finalOutputPath = path.join(outputDir, 'FullAudio.wav');
    const statusPath = path.join(outputDir, 'status.json');
    
    try {
      console.log('Starting audio extraction...', { tempOutputPath, finalOutputPath, statusPath });
      
      // Initialize status file
      const initialStatus = {
        status: 'starting',
        progress: 0,
        startTime: new Date().toISOString()
      };
      await fs.writeFile(statusPath, JSON.stringify(initialStatus));
      console.log('Initialized status file:', initialStatus);
      
      // First step: Extract audio using yt-dlp
      const ytdlProcess = spawn('yt-dlp', [
        '--extract-audio',
        '--audio-format', 'wav',
        '--output', tempOutputPath,
        '--no-warnings',
        '--no-call-home',
        '--prefer-free-formats',
        '--progress',
        videoUrl
      ]);

      let error = '';

      ytdlProcess.stderr.on('data', (data) => {
        const errorStr = data.toString();
        error += errorStr;
        console.error('Extraction error:', errorStr);
      });

      ytdlProcess.stdout.on('data', async (data) => {
        const output = data.toString();
        console.log('Raw output:', output);
        
        if (output.includes('%')) {
          const match = output.match(/(\d+\.?\d*)%/);
          if (match) {
            const progress = parseFloat(match[1]) * 0.5;
            console.log(`Download Progress: ${progress}%`);
            
            // Update status file with progress
            const progressStatus = {
              status: 'downloading',
              progress: progress,
              lastUpdate: new Date().toISOString()
            };
            
            try {
              await fs.writeFile(statusPath, JSON.stringify(progressStatus));
              console.log('Updated status file:', progressStatus);
            } catch (err) {
              console.error('Error updating status file:', err);
            }
          }
        }
      });

      ytdlProcess.on('close', async (code) => {
        if (code === 0) {
          console.log('Initial audio extraction completed, starting conversion...');
          
          try {
            // Update status for conversion phase
            await fs.writeFile(statusPath, JSON.stringify({
              status: 'converting',
              progress: 50,
              lastUpdate: new Date().toISOString()
            }));

            // Second step: Convert to specific format using ffmpeg
            const ffmpegProcess = spawn('ffmpeg', [
              '-i', tempOutputPath,
              '-acodec', 'pcm_s16le',
              '-ar', '16000',
              '-ac', '1',
              '-y',
              finalOutputPath
            ]);

            let ffmpegError = '';

            ffmpegProcess.stderr.on('data', (data) => {
              const errorStr = data.toString();
              console.log('FFmpeg progress:', errorStr);
              // Update progress from 50% to 100% during conversion
              const progressStatus = {
                status: 'converting',
                progress: 75,
                lastUpdate: new Date().toISOString()
              };
              fs.writeFile(statusPath, JSON.stringify(progressStatus))
                .catch(err => console.error('Error updating status during conversion:', err));
            });

            ffmpegProcess.on('close', async (ffmpegCode) => {
              if (ffmpegCode === 0) {
                console.log('Audio conversion completed successfully');
                
                // Clean up temporary file
                try {
                  await fs.unlink(tempOutputPath);
                } catch (unlinkError) {
                  console.error('Error removing temporary file:', unlinkError);
                }

                // Update status file with completion
                const completionStatus = {
                  status: 'completed',
                  progress: 100,
                  completionTime: new Date().toISOString()
                };
                
                try {
                  await fs.writeFile(statusPath, JSON.stringify(completionStatus));
                  console.log('Updated status file with completion:', completionStatus);
                } catch (err) {
                  console.error('Error updating final status:', err);
                }
                
                resolve({
                  status: 'completed',
                  outputPath: finalOutputPath,
                  message: 'Audio extraction and conversion completed successfully'
                });
              } else {
                throw new Error(`FFmpeg conversion failed with code ${ffmpegCode}`);
              }
            });
          } catch (conversionError) {
            throw new Error(`Conversion failed: ${conversionError.message}`);
          }
        } else {
          throw new Error(`Initial extraction failed with code ${code}: ${error}`);
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
        console.log('Updated status file with error:', errorStatus);
      } catch (err) {
        console.error('Error updating error status:', err);
      }
      
      reject(error);
    }
  });
}

// Extract audio chunks for live stream
async function extractLiveAudioChunks(videoUrl, outputDir, liveStreamChoice) {
  return new Promise(async (resolve, reject) => {
    let process;
    let isShuttingDown = false;

    try {
      console.log('Starting live stream audio extraction...');
      
      // Use numbered fragments for output with WAV format
      const outputTemplate = path.join(outputDir, 'fragment-%d.wav');
      
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

      // Add live-from-start flag only if starting from beginning
      if (liveStreamChoice === 'beginning') {
        ytdlpArgs.push('--live-from-start');
      }

      // Add the URL as the last argument
      ytdlpArgs.push(videoUrl);
      
      process = spawn('yt-dlp', ytdlpArgs);

      let ffmpegProcess = spawn('ffmpeg', [
        '-i', 'pipe:0',        // Read from stdin
        '-f', 'segment',       // Enable segmentation
        '-segment_time', '20',  // Changed from 6 to 20 seconds per segment
        '-reset_timestamps', '1',
        '-acodec', 'pcm_s16le', // LINEAR16 encoding
        '-ar', '16000',         // 16 kHz sample rate
        '-ac', '1',             // Mono channel
        '-map', '0:a',          // Only process audio
        outputTemplate          // Output pattern
      ]);

      // Pipe yt-dlp output to ffmpeg
      process.stdout.pipe(ffmpegProcess.stdin);

      let error = '';
      let lastProgressTime = Date.now();

      // Function to check for progress
      const checkProgress = () => {
        const now = Date.now();
        if (now - lastProgressTime > 60000 && !isShuttingDown) { // 1 minute without progress
          console.error('No progress for 1 minute, restarting stream...');
          try {
            process.kill();
            ffmpegProcess.kill();
            // The process will be restarted by the error handler
          } catch (err) {
            console.error('Error killing stalled process:', err);
          }
        }
      };

      // Set up progress check interval
      const progressInterval = setInterval(checkProgress, 10000);

      process.stderr.on('data', (data) => {
        const errorStr = data.toString();
        error += errorStr;
        console.error('Live stream error:', errorStr);
      });

      ffmpegProcess.stderr.on('data', (data) => {
        const output = data.toString();
        console.log('FFmpeg output:', output);
        lastProgressTime = Date.now(); // Update progress time
      });

      // Resolve immediately for live streams as it's an ongoing process
      resolve({
        status: 'started',
        outputDir,
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
          clearInterval(progressInterval);
          if (process) {
            process.kill();
          }
          if (ffmpegProcess) {
            ffmpegProcess.kill();
          }
        }
      });

      process.on('close', (code) => {
        clearInterval(progressInterval);
        if (code !== 0 && !isShuttingDown) {
          console.error('Live stream extraction ended with error:', error);
          console.log('Attempting to restart stream extraction...');
          // Restart the stream extraction after a short delay
          setTimeout(() => {
            extractLiveAudioChunks(videoUrl, outputDir, liveStreamChoice)
              .catch(err => console.error('Failed to restart stream:', err));
          }, 5000);
        }
      });

      process.on('error', (err) => {
        clearInterval(progressInterval);
        console.error('Live stream process error:', err);
        if (!isShuttingDown) {
          // Attempt to restart on error
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

// Extract audio from video
async function extractAudio(videoUrl, videoId, isLive, liveStreamChoice) {
  try {
    // Create output directory
    const outputDir = path.join(AUDIO_BASE_DIR, videoId);
    await ensureDirectoryExists(outputDir);

    // Get video info first
    const info = await getVideoInfo(videoUrl);
    console.log('Video info retrieved:', {
      title: info.title,
      duration: info.duration,
      isLive: info._type === 'live' || info.is_live
    });

    // If it's a live stream
    if (isLive) {
      if (!liveStreamChoice) {
        throw new Error('Live stream choice is required for live content');
      }
      return extractLiveAudioChunks(videoUrl, outputDir, liveStreamChoice);
    }

    // For normal videos
    return extractNormalAudio(videoUrl, outputDir);
  } catch (error) {
    console.error('Error in extractAudio:', error);
    throw error;
  }
}

export { extractAudio }; 