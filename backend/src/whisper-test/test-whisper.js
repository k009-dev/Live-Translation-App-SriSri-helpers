import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';

const execAsync = promisify(exec);

async function ensureDirectoryExists(dirPath) {
    try {
        await fs.access(dirPath);
    } catch {
        await fs.mkdir(dirPath, { recursive: true });
    }
}

async function transcribeAudio(audioPath, options = {}) {
    try {
        console.log('Starting transcription for:', audioPath);
        
        // Default options optimized for CPU processing with small model
        const defaultOptions = {
            model: 'small',    // Good balance of speed and accuracy (244MB)
            language: null,     // Auto-detect language
            outputFormat: 'json',
            task: 'transcribe',
            // CPU optimization parameters
            beam_size: 1,           // Faster beam search
            best_of: 1,            // No multiple passes
            temperature: 0,        // Greedy decoding
            no_speech_threshold: 0.6,  // Filter silence
            condition_on_previous_text: false,  // Disable context
            fp16: false,          // Use FP32 for CPU
            threads: 4,           // CPU threads
            // Additional optimizations
            vad_filter: true,     // Voice activity detection
            word_timestamps: false // Disable word timestamps for speed
        };

        const finalOptions = { ...defaultOptions, ...options };
        
        // Create absolute paths
        const absoluteAudioPath = path.resolve(audioPath);
        const outputDir = path.resolve(process.cwd(), 'src/whisper-test/temp_output');
        
        // Ensure output directory exists
        await ensureDirectoryExists(outputDir);
        
        console.log('Using paths:', {
            audioPath: absoluteAudioPath,
            outputDir
        });

        // Construct whisper command with CPU optimizations
        let command = `whisper "${absoluteAudioPath}" --model ${finalOptions.model} --output_format ${finalOptions.outputFormat} --output_dir "${outputDir}" --task ${finalOptions.task} --beam_size 1 --best_of 1 --temperature 0 --no_speech_threshold 0.6 --condition_on_previous_text False --fp16 False --threads 4`;

        console.log('Executing command:', command);
        
        // Execute whisper
        const { stdout, stderr } = await execAsync(command);
        
        if (stderr) {
            console.error('Stderr:', stderr);
        }
        
        console.log('Stdout:', stdout);

        // Read the output file
        const outputFile = path.join(outputDir, path.basename(audioPath, path.extname(audioPath)) + '.json');
        console.log('Reading output file:', outputFile);
        
        const result = await fs.readFile(outputFile, 'utf8');
        return JSON.parse(result);

    } catch (error) {
        console.error('Transcription error:', error);
        throw error;
    }
}

// Test the transcription
async function testWhisper() {
    try {
        // Get the absolute path to the audio file
        const audioPath = path.resolve(process.cwd(), 'temp_files/ExtractedAudio/SDe4JT0TinM/FinalExtracted/fragment-0.wav');
        
        console.log('Testing Whisper transcription');
        console.log('Audio file:', audioPath);
        
        // Check if audio file exists
        try {
            await fs.access(audioPath);
            console.log('Audio file exists');
        } catch (err) {
            console.error('Audio file does not exist:', err);
            return;
        }
        
        const result = await transcribeAudio(audioPath);  // Using default medium model settings
        
        console.log('\nTranscription result:');
        console.log(JSON.stringify(result, null, 2));
        
    } catch (error) {
        console.error('Test failed:', error);
    }
}

// Run the test
testWhisper(); 