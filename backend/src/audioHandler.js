import dotenv from 'dotenv';
import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';

dotenv.config();

// Configuration
if (!process.env.ELEVENLABS_API_KEY) {
    console.error('Error: ELEVENLABS_API_KEY is not set in environment variables');
    process.exit(1);
}

const ELEVEN_LABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVEN_LABS_MODEL = "eleven_multilingual_v2";
let ELEVEN_LABS_VOICE_ID = null;

// Constants
const MAX_CHUNK_LENGTH = 2500; // Maximum characters per API call
const RATE_LIMIT_DELAY = 1000; // 1 second between API calls
const MAX_RETRIES = 3;
const RETRY_DELAY = 2000;

// Voice quality presets
const VOICE_SETTINGS = {
    default: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0.0,
        use_speaker_boost: true
    },
    high_quality: {
        stability: 0.7,
        similarity_boost: 0.8,
        style: 0.0,
        use_speaker_boost: true
    },
    maximum_quality: {
        stability: 0.9,
        similarity_boost: 0.9,
        style: 0.0,
        use_speaker_boost: true
    }
};

// Language-specific voice mappings
const LANGUAGE_VOICE_MAPPINGS = {
    hi: "Hindi",
    mr: "Marathi",
    gu: "Gujarati",
    ta: "Tamil",
    te: "Telugu",
    ml: "Malayalam",
    kn: "Kannada",
    pa: "Punjabi",
    fr: "French",
    ru: "Russian",
    es: "Spanish",
    sa: "Sanskrit"
};

/**
 * Rate limiter utility
 */
const rateLimiter = {
    lastCall: 0,
    async wait() {
        const now = Date.now();
        const timeSinceLastCall = now - this.lastCall;
        if (timeSinceLastCall < RATE_LIMIT_DELAY) {
            await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY - timeSinceLastCall));
        }
        this.lastCall = Date.now();
    }
};

/**
 * Retry wrapper for API calls
 */
async function withRetry(operation) {
    for (let i = 0; i < MAX_RETRIES; i++) {
        try {
            await rateLimiter.wait();
            return await operation();
        } catch (error) {
            if (i === MAX_RETRIES - 1) throw error;
            console.log(`Attempt ${i + 1} failed, retrying in ${RETRY_DELAY}ms...`);
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
        }
    }
}

/**
 * Split text into chunks for API processing
 */
function splitIntoChunks(text) {
    const chunks = [];
    let currentChunk = '';
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];

    for (const sentence of sentences) {
        if (currentChunk.length + sentence.length <= MAX_CHUNK_LENGTH) {
            currentChunk += sentence;
        } else {
            if (currentChunk) chunks.push(currentChunk.trim());
            currentChunk = sentence;
        }
    }
    if (currentChunk) chunks.push(currentChunk.trim());
    return chunks;
}

/**
 * Fetch available voices from Eleven Labs
 */
async function getAvailableVoices() {
    return await withRetry(async () => {
        const response = await axios({
            method: 'GET',
            url: 'https://api.elevenlabs.io/v1/voices',
            headers: {
                'xi-api-key': ELEVEN_LABS_API_KEY
            }
        });

        if (response.status === 200 && response.data.voices) {
            const voices = response.data.voices.map(v => ({
                name: v.name,
                voice_id: v.voice_id,
                languages: v.labels?.language || [],
                preview_url: v.preview_url
            }));

            // Set default voice if none specified
            if (!ELEVEN_LABS_VOICE_ID && voices.length > 0) {
                ELEVEN_LABS_VOICE_ID = voices[0].voice_id;
            }

            return voices;
        }
        throw new Error('No voices found in the response');
    });
}

/**
 * Find best voice for a language
 */
async function findBestVoiceForLanguage(language, voices) {
    const langCode = language.toLowerCase();
    const langName = LANGUAGE_VOICE_MAPPINGS[langCode] || language;

    // Try to find a voice specifically for this language
    let voice = voices.find(v => 
        v.languages.some(l => 
            l.toLowerCase() === langCode || 
            l.toLowerCase() === langName.toLowerCase()
        )
    );

    // If no specific voice found, use default multilingual voice
    if (!voice) {
        voice = voices.find(v => v.languages.includes('multilingual')) || voices[0];
    }

    return voice?.voice_id || ELEVEN_LABS_VOICE_ID;
}

/**
 * Generate audio using Eleven Labs TTS API
 */
async function generateAudio(text, language, voiceId = ELEVEN_LABS_VOICE_ID, quality = 'default') {
    if (!text.trim()) {
        throw new Error('Empty text provided');
    }

    const chunks = splitIntoChunks(text);
    const audioChunks = [];

    for (const chunk of chunks) {
        const audio = await withRetry(async () => {
            const response = await axios({
                method: 'POST',
                url: `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
                headers: {
                    'Accept': 'audio/mpeg',
                    'xi-api-key': ELEVEN_LABS_API_KEY,
                    'Content-Type': 'application/json',
                },
                data: {
                    text: chunk,
                    model_id: ELEVEN_LABS_MODEL,
                    voice_settings: VOICE_SETTINGS[quality] || VOICE_SETTINGS.default
                },
                responseType: 'arraybuffer'
            });

            return response.data;
        });

        audioChunks.push(audio);
    }

    // Combine audio chunks
    const combinedAudio = Buffer.concat(audioChunks);
    return `data:audio/mpeg;base64,${combinedAudio.toString('base64')}`;
}

/**
 * Process languages in pairs for audio generation
 */
async function processLanguagesInPairs(translations, languages) {
    const audioResults = {};
    const languagePairs = [];
    
    // Create pairs of languages
    for (let i = 0; i < languages.length; i += 2) {
        const pair = languages.slice(i, i + 2);
        languagePairs.push(pair);
    }

    // Get available voices
    const voices = await getAvailableVoices();

    // Process each pair sequentially
    for (const pair of languagePairs) {
        console.log(`Processing language pair: ${pair.join(', ')}`);
        
        // Process the pair in parallel
        const pairResults = await Promise.all(pair.map(async (lang) => {
            const translation = translations[lang];
            if (!translation?.text) return { [`${lang}_audio`]: null };

            try {
                const voiceId = await findBestVoiceForLanguage(translation.languageCode || lang, voices);
                const audio = await generateAudio(
                    translation.text,
                    translation.languageCode || lang,
                    voiceId,
                    'high_quality'
                );
                return { [`${lang}_audio`]: audio };
            } catch (error) {
                console.error(`Audio generation failed for ${lang}:`, error.message);
                return { [`${lang}_audio`]: null };
            }
        }));

        // Merge results
        pairResults.forEach(result => {
            Object.assign(audioResults, result);
        });
    }

    return audioResults;
}

/**
 * Save audio file with quality check
 */
async function saveAudioFile(audioDataURI, outputPath) {
    if (!audioDataURI) return false;
    
    try {
        const audioBuffer = Buffer.from(audioDataURI.split(',')[1], 'base64');
        
        // Verify audio file size
        if (audioBuffer.length < 100) {
            throw new Error('Generated audio file is too small, might be corrupted');
        }

        await fs.writeFile(outputPath, audioBuffer);
        
        // Verify file was written
        const stats = await fs.stat(outputPath);
        if (stats.size !== audioBuffer.length) {
            throw new Error('File size mismatch after saving');
        }

        return true;
    } catch (error) {
        console.error('Error saving audio file:', error);
        return false;
    }
}

// Initialize voices when imported
(async () => {
    try {
        await getAvailableVoices();
    } catch (error) {
        console.error('Failed to initialize voices:', error);
    }
})();

export { 
    processLanguagesInPairs, 
    generateAudio, 
    saveAudioFile,
    VOICE_SETTINGS,
    findBestVoiceForLanguage
}; 