// Import necessary libraries
import OpenAI from 'openai';
import fs from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';
import { createReadStream } from 'fs';

// Load environment variables
dotenv.config();

// Initialize OpenAI client
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// Function to ensure directory exists
async function ensureDirectoryExists(dirPath) {
    try {
        await fs.access(dirPath);
    } catch {
        await fs.mkdir(dirPath, { recursive: true });
    }
}

// Function to transcribe audio using Whisper API
async function transcribeAudio(audioPath) {
    try {
        const absoluteAudioPath = path.isAbsolute(audioPath) ? audioPath : path.resolve(process.cwd(), audioPath);
        
        // Create a read stream for the audio file
        const audioStream = createReadStream(absoluteAudioPath);

        // Call Whisper API with minimal settings
        const transcription = await openai.audio.transcriptions.create({
            file: audioStream,
            model: 'whisper-1',
            response_format: 'verbose_json'
        });

        // Format results
        const results = {
            text: transcription.text,
            language: transcription.language,
            duration: transcription.duration,
            segments: transcription.segments
        };

        // Save results to JSON file
        const outputDir = path.join(process.cwd(), 'src', 'whisper-api-test', 'temp_output');
        const outputPath = path.join(outputDir, path.basename(absoluteAudioPath, '.wav') + '.json');
        
        await ensureDirectoryExists(outputDir);
        await fs.writeFile(outputPath, JSON.stringify(results, null, 2));
        
        console.log('\nTranscription:', results.text);
        console.log('Language:', results.language);
        
        return results;

    } catch (error) {
        console.error('Error during transcription:', error);
        throw error;
    }
}

// Test the transcription
const audioPath = process.env.AUDIO_PATH || 'temp_files/ExtractedAudio/vsUJgYD8q60/FinalExtracted/fragment-0.wav';
transcribeAudio(audioPath)
    .then(() => console.log('Transcription test completed'))
    .catch(error => console.error('Transcription test failed:', error)); 