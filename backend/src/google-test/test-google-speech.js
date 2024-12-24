// Import necessary libraries
import speech from '@google-cloud/speech';
import fs from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

// Verify environment variables
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS || !process.env.GOOGLE_CLOUD_PROJECT) {
    console.error('Error: Google Cloud credentials not found in .env file');
    console.error('Please ensure GOOGLE_APPLICATION_CREDENTIALS and GOOGLE_CLOUD_PROJECT are set');
    process.exit(1);
}

// Configure language configurations to try
const languageConfigs = [
    {
        languageCode: 'en-IN',
        alternativeLanguageCodes: ['hi-IN', 'kn-IN', 'ta-IN', 'mr-IN']
    },
    {
        languageCode: 'hi-IN',
        alternativeLanguageCodes: ['en-IN', 'kn-IN', 'ta-IN', 'mr-IN']
    },
    {
        languageCode: 'kn-IN',
        alternativeLanguageCodes: ['en-IN', 'hi-IN', 'ta-IN', 'mr-IN']
    },
    {
        languageCode: 'ta-IN',
        alternativeLanguageCodes: ['en-IN', 'hi-IN', 'kn-IN', 'mr-IN']
    }
];

// Base configuration for Speech-to-Text
const baseConfig = {
    encoding: 'LINEAR16',
    sampleRateHertz: 16000,
    model: 'latest_long',
    useEnhanced: true,
    enableWordTimeOffsets: true,
    enableWordConfidence: true,
    enableAutomaticPunctuation: true,
    maxAlternatives: 3,
    speechContexts: [{
        phrases: [
            // Common Indian words and phrases
            'namaste', 'dhanyavaad', 'shukriya',
            // Add more common phrases here
        ],
        boost: 20
    }]
};

// Initialize the Speech-to-Text client with additional settings
const client = new speech.SpeechClient({
    projectId: process.env.GOOGLE_CLOUD_PROJECT,
    keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    apiEndpoint: 'speech.googleapis.com',
    fallback: true,
    retry: {
        retries: 3,
        backoff: {
            initial: 100,
            max: 60000,
            multiplier: 1.3
        }
    }
});

// Function to ensure directory exists
async function ensureDirectoryExists(dirPath) {
    try {
        await fs.access(dirPath);
    } catch {
        await fs.mkdir(dirPath, { recursive: true });
        console.log('Created directory:', dirPath);
    }
}

// Function to transcribe audio with a specific language config
async function transcribeWithLanguage(audioBytes, languageConfig) {
    const config = {
        ...baseConfig,
        ...languageConfig
    };

    const request = {
        config,
        audio: { content: audioBytes.toString('base64') }
    };

    console.log(`Trying transcription with primary language: ${languageConfig.languageCode}`);
    const [response] = await client.recognize(request);

    if (!response.results || response.results.length === 0) {
        return null;
    }

    // Calculate average confidence for this language configuration
    const results = response.results
        .filter(result => result.alternatives[0].transcript.trim() !== '');

    if (results.length === 0) {
        return null;
    }

    const avgConfidence = results.reduce((sum, result) => 
        sum + (result.alternatives[0].confidence || 0), 0) / results.length;

    return {
        languageCode: languageConfig.languageCode,
        confidence: avgConfidence,
        results: results.map(result => ({
            transcript: result.alternatives[0].transcript,
            confidence: result.alternatives[0].confidence,
            words: result.alternatives[0].words?.map(word => ({
                word: word.word,
                startTime: `${word.startTime.seconds || 0}.${(word.startTime.nanos || 0) / 1000000}s`,
                endTime: `${word.endTime.seconds || 0}.${(word.endTime.nanos || 0) / 1000000}s`,
                confidence: word.confidence,
            })) || []
        }))
    };
}

// Function to transcribe audio
async function transcribeAudio(audioPath) {
    try {
        // Convert to absolute path if relative
        const absoluteAudioPath = path.isAbsolute(audioPath) ? audioPath : path.resolve(process.cwd(), audioPath);
        console.log('Processing audio file:', absoluteAudioPath);

        // Check if audio file exists
        try {
            await fs.access(absoluteAudioPath);
            console.log('Audio file exists');
        } catch (error) {
            throw new Error(`Audio file not found at ${absoluteAudioPath}`);
        }

        // Read the audio file
        const audioBytes = await fs.readFile(absoluteAudioPath);
        
        console.log('Starting parallel transcription for all languages...');
        
        // Process all languages in parallel
        const transcriptionPromises = languageConfigs.map(langConfig => 
            transcribeWithLanguage(audioBytes, langConfig)
                .catch(error => {
                    console.error(`Error with language ${langConfig.languageCode}:`, error.message);
                    return null;
                })
        );

        // Wait for all transcriptions to complete
        const allResults = (await Promise.all(transcriptionPromises)).filter(result => result !== null);

        if (allResults.length === 0) {
            throw new Error('No successful transcriptions');
        }

        // Find the result with highest confidence
        const bestResult = allResults.reduce((best, current) => 
            (current.confidence > best.confidence) ? current : best
        );

        console.log('\nTranscription results for all languages:');
        allResults.forEach(result => {
            console.log(`${result.languageCode}: Confidence ${(result.confidence * 100).toFixed(2)}%`);
        });

        console.log(`\nBest result was ${bestResult.languageCode} with ${(bestResult.confidence * 100).toFixed(2)}% confidence`);

        // Format final results
        const finalResults = {
            bestLanguage: bestResult.languageCode,
            confidence: bestResult.confidence,
            transcription: bestResult.results,
            allAttempts: allResults.map(r => ({
                languageCode: r.languageCode,
                confidence: r.confidence,
                transcript: r.results[0]?.transcript || ''  // Include transcript from each attempt
            })),
            metadata: {
                totalWords: bestResult.results.reduce((acc, r) => acc + (r.words?.length || 0), 0),
                processedAt: new Date().toISOString(),
                languages: languageConfigs.map(c => c.languageCode),
                processingTime: {
                    start: new Date().toISOString()
                }
            }
        };

        // Prepare output directory and file path
        const outputDir = path.join(process.cwd(), 'src', 'google-test', 'temp_output');
        const outputPath = path.join(outputDir, path.basename(absoluteAudioPath, '.wav') + '.json');

        // Ensure output directory exists
        await ensureDirectoryExists(outputDir);

        // Add end time to metadata
        finalResults.metadata.processingTime.end = new Date().toISOString();
        finalResults.metadata.processingTime.duration = 
            new Date(finalResults.metadata.processingTime.end) - 
            new Date(finalResults.metadata.processingTime.start);

        // Save results to JSON file
        await fs.writeFile(outputPath, JSON.stringify(finalResults, null, 2));
        console.log('\nResults saved to:', outputPath);

        // Log all transcriptions
        console.log('\nTranscriptions from all languages:');
        allResults.forEach(result => {
            console.log(`\n${result.languageCode.toUpperCase()}:`);
            result.results.forEach((r, index) => {
                console.log(`Segment ${index + 1} (${(r.confidence * 100).toFixed(2)}%): ${r.transcript}`);
            });
        });

        console.log('\nBest Transcription:');
        bestResult.results.forEach((result, index) => {
            console.log(`Segment ${index + 1}: ${result.transcript}`);
        });

        return finalResults;

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
