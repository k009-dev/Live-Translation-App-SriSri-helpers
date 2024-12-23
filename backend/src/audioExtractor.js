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
    const outputPath = path.join(outputDir, 'FullAudio.mp3');
    
    try {
      console.log('Starting audio extraction...');
      
      const process = spawn('yt-dlp', [
        '--extract-audio',
        '--audio-format', 'mp3',
        '--audio-quality', '0',
        '--output', outputPath,
        '--no-warnings',
        '--no-call-home',
        '--prefer-free-formats',
        videoUrl
      ]);

      let error = '';

      process.stderr.on('data', (data) => {
        const errorStr = data.toString();
        error += errorStr;
        console.error('Extraction error:', errorStr);
      });

      process.stdout.on('data', (data) => {
        const output = data.toString();
        if (output.includes('%')) {
          const match = output.match(/(\d+\.?\d*)%/);
          if (match) {
            console.log(`Progress: ${match[1]}%`);
          }
        }
      });

      process.on('close', (code) => {
        if (code === 0) {
          console.log('Audio extraction completed successfully');
          resolve({
            status: 'completed',
            outputPath,
            message: 'Audio extraction completed successfully'
          });
        } else {
          console.error('Error during extraction:', error);
          reject(new Error(`Extraction failed with code ${code}: ${error}`));
        }
      });

    } catch (error) {
      console.error('Error setting up audio extraction:', error);
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
      
      // Use numbered fragments for output
      const outputTemplate = path.join(outputDir, 'fragment-%d.mp3');
      
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
        '-segment_time', '6',  // 6 seconds per segment
        '-reset_timestamps', '1',
        '-c:a', 'libmp3lame', // MP3 codec
        '-q:a', '0',          // Highest quality
        '-map', '0:a',        // Only process audio
        outputTemplate        // Output pattern
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