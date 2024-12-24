import OpenAI from 'openai';
import fs from 'fs/promises';
import path from 'path';
import { createReadStream } from 'fs';
import { watch } from 'fs';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Initialize OpenAI client
if (!process.env.OPENAI_API_KEY) {
    console.error('Error: OPENAI_API_KEY is not set in environment variables');
    process.exit(1);
}

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// Ensure directory exists
async function ensureDirectoryExists(dirPath) {
    try {
        await fs.access(dirPath);
    } catch {
        await fs.mkdir(dirPath, { recursive: true });
    }
}

// Function to transcribe a single audio fragment
async function transcribeAudioFragment(audioPath, outputPath) {
    try {
        console.log('\n=== Starting Transcription ===');
        console.log(`Input: ${audioPath}`);
        console.log(`Output: ${outputPath}`);
        
        // 1. Verify input file
        try {
            const stats = await fs.stat(audioPath);
            console.log(`Audio file size: ${stats.size} bytes`);
            if (stats.size === 0) {
                throw new Error('Audio file is empty');
            }
        } catch (error) {
            console.error('❌ Audio file error:', error.message);
            throw error;
        }
        
        // 2. Create stream and verify
        let audioStream;
        try {
            audioStream = createReadStream(audioPath);
            console.log('✓ Audio stream created');
        } catch (error) {
            console.error('❌ Stream creation error:', error.message);
            throw error;
        }
        
        // 3. Make API call
        console.log('Making Whisper API call...');
        let transcription;
        try {
            transcription = await openai.audio.transcriptions.create({
                file: audioStream,
                model: 'whisper-1',
                response_format: 'verbose_json',
                temperature: 0,
                language: 'en'
            });
            console.log('✓ API call successful');
        } catch (error) {
            console.error('❌ API call failed:', error.message);
            if (error.response) {
                console.error('API Response:', {
                    status: error.response.status,
                    data: error.response.data
                });
            }
            throw error;
        }

        // 4. Prepare results
        const results = {
            text: transcription.text,
            segments: transcription.segments,
            duration: transcription.duration,
            audioFile: path.basename(audioPath),
            timestamp: new Date().toISOString()
        };

        // 5. Save results
        try {
            // Ensure the directory exists again just before writing
            await ensureDirectoryExists(path.dirname(outputPath));
            
            // Test write permissions
            const testPath = path.join(path.dirname(outputPath), '.test');
            await fs.writeFile(testPath, 'test');
            await fs.unlink(testPath);
            console.log('✓ Write permissions verified');
            
            // Write the actual file
            await fs.writeFile(outputPath, JSON.stringify(results, null, 2));
            console.log(`✓ Results saved to: ${outputPath}`);
        } catch (error) {
            console.error('❌ Error saving results:', error.message);
            throw error;
        }

        console.log('=== Transcription Complete ===\n');
        return results;

    } catch (error) {
        console.error(`\n❌ Transcription failed for ${path.basename(audioPath)}`);
        console.error('Error details:', error);
        throw error;
    }
}

// Function to setup transcription for a video
async function setupTranscriptionWatcher(videoId) {
    try {
        console.log('\n=== Setting up Transcription Process ===');
        console.log('Video ID:', videoId);

        const baseDir = process.cwd();
        console.log('Base directory:', baseDir);

        const finalExtractedDir = path.join(baseDir, 'temp_files', videoId, 'ExtractedAudio', 'FinalExtracted');
        const extractedTextDir = path.join(baseDir, 'temp_files', videoId, 'ExtractedText');

        console.log('Directories:');
        console.log('- FinalExtracted:', finalExtractedDir);
        console.log('- ExtractedText:', extractedTextDir);

        // Verify FinalExtracted exists
        try {
            await fs.access(finalExtractedDir);
            console.log('✓ FinalExtracted directory exists');
        } catch (error) {
            console.error('❌ FinalExtracted directory not found');
            throw error;
        }

        // Create ExtractedText directory
        try {
            await ensureDirectoryExists(extractedTextDir);
            console.log('✓ ExtractedText directory ready');
            
            // Verify write permissions
            const testPath = path.join(extractedTextDir, '.test');
            await fs.writeFile(testPath, 'test');
            await fs.unlink(testPath);
            console.log('✓ Write permissions verified');
        } catch (error) {
            console.error('❌ Cannot create or write to ExtractedText directory:', error.message);
            throw error;
        }

        // Get existing transcriptions
        const existingTranscriptions = new Set();
        try {
            const files = await fs.readdir(extractedTextDir);
            const jsonFiles = files.filter(f => f.endsWith('.json'));
            console.log(`Found ${jsonFiles.length} existing transcriptions`);
            jsonFiles.forEach(f => {
                existingTranscriptions.add(f.replace('.json', '.wav'));
                console.log(`- Existing: ${f}`);
            });
        } catch (error) {
            console.log('No existing transcriptions found');
        }

        // Process audio files
        try {
            console.log('\n=== Starting Initial File Processing ===');
            const audioFiles = await fs.readdir(finalExtractedDir);
            const wavFiles = audioFiles.filter(file => file.endsWith('.wav'));
            console.log(`Found ${wavFiles.length} WAV files to process`);

            const sortedAudioFiles = wavFiles.sort((a, b) => {
                const numA = parseInt(a.match(/fragment-(\d+)\.wav$/)?.[1] || '0');
                const numB = parseInt(b.match(/fragment-(\d+)\.wav$/)?.[1] || '0');
                return numA - numB;
            });

            console.log('Processing order:', sortedAudioFiles.join(', '));

            // Process each file
            for (const file of sortedAudioFiles) {
                if (!existingTranscriptions.has(file)) {
                    console.log(`\n>>> Starting transcription for: ${file}`);
                    const audioPath = path.join(finalExtractedDir, file);
                    const outputPath = path.join(extractedTextDir, `${path.basename(file, '.wav')}.json`);
                    
                    try {
                        await transcribeAudioFragment(audioPath, outputPath);
                        console.log(`✓ Successfully transcribed: ${file}`);
                        existingTranscriptions.add(file);
                    } catch (error) {
                        console.error(`❌ Failed to transcribe ${file}:`, error.message);
                        // Continue with next file even if one fails
                    }
                } else {
                    console.log(`Skipping existing: ${file}`);
                }
            }

            console.log('\n=== Initial Processing Complete ===');
        } catch (error) {
            console.error('❌ Error processing files:', error.message);
            throw error;
        }

        // Set up watcher for new files
        console.log('\n=== Setting up File Watcher ===');
        const watcher = watch(finalExtractedDir, { persistent: true });
        
        watcher.on('change', async (eventType, filename) => {
            console.log(`File watcher event: ${eventType} - ${filename}`);
            if (filename && filename.endsWith('.wav')) {
                // Wait a bit to ensure file is completely written
                setTimeout(async () => {
                    if (!existingTranscriptions.has(filename)) {
                        console.log(`\n>>> Processing new file: ${filename}`);
                        const audioPath = path.join(finalExtractedDir, filename);
                        const outputPath = path.join(extractedTextDir, `${path.basename(filename, '.wav')}.json`);
                        
                        try {
                            await transcribeAudioFragment(audioPath, outputPath);
                            console.log(`✓ Successfully transcribed new file: ${filename}`);
                            existingTranscriptions.add(filename);
                        } catch (error) {
                            console.error(`❌ Failed to transcribe new file ${filename}:`, error.message);
                        }
                    }
                }, 1000);
            }
        });

        console.log('✓ File watcher setup complete');
        return watcher;
    } catch (error) {
        console.error('\n❌ Fatal Error:', error.message);
        throw error;
    }
}

// Function to get transcription status
async function getTranscriptionStatus(videoId) {
    try {
        const baseDir = process.cwd();
        const finalExtractedDir = path.join(baseDir, 'temp_files', videoId, 'ExtractedAudio', 'FinalExtracted');
        const extractedTextDir = path.join(baseDir, 'temp_files', videoId, 'ExtractedText');

        const audioFiles = await fs.readdir(finalExtractedDir).then(
            files => files.filter(f => f.endsWith('.wav'))
        ).catch(() => []);

        const transcriptionFiles = await fs.readdir(extractedTextDir).then(
            files => files.filter(f => f.endsWith('.json'))
        ).catch(() => []);

        return {
            totalAudioFiles: audioFiles.length,
            transcribedFiles: transcriptionFiles.length,
            progress: audioFiles.length ? (transcriptionFiles.length / audioFiles.length) * 100 : 0,
            isComplete: audioFiles.length > 0 && audioFiles.length === transcriptionFiles.length
        };
    } catch (error) {
        return {
            totalAudioFiles: 0,
            transcribedFiles: 0,
            progress: 0,
            isComplete: false,
            error: error.message
        };
    }
}

export { setupTranscriptionWatcher, getTranscriptionStatus };
