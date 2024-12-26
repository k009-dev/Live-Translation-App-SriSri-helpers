import fs from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';

// Configure dotenv with the path to your .env file
dotenv.config({ path: path.join(process.cwd(), 'backend', '.env') });

// Check if API key exists
const ELEVEN_LABS_API_KEY = process.env.ELEVENLABS_API_KEY;
if (!ELEVEN_LABS_API_KEY) {
    console.error('Error: ELEVENLABS_API_KEY is not set in environment variables');
    process.exit(1);
}

const API_URL = 'https://api.elevenlabs.io/v1';

// Cache for voice IDs
let voiceCache = null;

/**
 * Fetch available voices from ElevenLabs API
 */
async function getVoices() {
    try {
        if (voiceCache) return voiceCache;

        const response = await fetch(`${API_URL}/voices`, {
            headers: {
                'xi-api-key': ELEVEN_LABS_API_KEY
            }
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch voices: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        
        // Create a map of language to voice ID
        const voiceMap = {};
        data.voices.forEach(voice => {
            // Use the first available voice for each language
            // You might want to customize this selection logic
            if (!voiceMap[voice.name]) {
                voiceMap[voice.name] = voice.voice_id;
            }
        });

        voiceCache = voiceMap;
        return voiceMap;
    } catch (error) {
        console.error('Error fetching voices:', error);
        return null;
    }
}

/**
 * Validate API key with retry logic
 */
async function validateApiKey(retries = 3, delay = 2000) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            console.log(`Attempt ${attempt} to validate API key...`);
            
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
            
            const response = await fetch(`${API_URL}/user/subscription`, {
                headers: {
                    'xi-api-key': ELEVEN_LABS_API_KEY
                },
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`Invalid API key: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            console.log('API key validated successfully. Character quota:', data.character_count, '/', data.character_limit);
            return true;
        } catch (error) {
            console.error(`API key validation attempt ${attempt} failed:`, error);
            
            if (attempt === retries) {
                console.error('All validation attempts failed');
                return false;
            }
            
            console.log(`Waiting ${delay}ms before next attempt...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    return false;
}

/**
 * Generate audio for a single text using ElevenLabs API with retry logic
 */
async function generateAudio(text, language, retries = 3, delay = 2000) {
    try {
        if (!text || !language) {
            console.error('Missing required parameters for audio generation');
            return null;
        }

        // Validate API key first
        const isValid = await validateApiKey();
        if (!isValid) {
            throw new Error('Invalid API key');
        }

        // Get available voices
        const voices = await getVoices();
        if (!voices) {
            throw new Error('Failed to fetch voices');
        }

        // Select a voice for the language
        const voiceId = voices[language] || Object.values(voices)[0]; // Fallback to first available voice
        if (!voiceId) {
            throw new Error(`No voice found for language: ${language}`);
        }

        console.log(`Using voice ID ${voiceId} for ${language}`);
        
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                console.log(`Attempt ${attempt} to generate audio...`);
                
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout for audio generation
                
                const response = await fetch(`${API_URL}/text-to-speech/${voiceId}`, {
                    method: 'POST',
                    headers: {
                        'Accept': 'audio/mpeg',
                        'Content-Type': 'application/json',
                        'xi-api-key': ELEVEN_LABS_API_KEY
                    },
                    body: JSON.stringify({
                        text: text,
                        model_id: 'eleven_multilingual_v2',
                        voice_settings: {
                            stability: 0.5,
                            similarity_boost: 0.75,
                            style: 0.5,
                            use_speaker_boost: true
                        }
                    }),
                    signal: controller.signal
                });
                
                clearTimeout(timeoutId);

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`ElevenLabs API error: ${response.status} ${response.statusText}\n${errorText}`);
                }

                const audioBuffer = await response.arrayBuffer();
                return Buffer.from(audioBuffer);
            } catch (error) {
                console.error(`Audio generation attempt ${attempt} failed:`, error);
                
                if (attempt === retries) {
                    throw error;
                }
                
                console.log(`Waiting ${delay}ms before next attempt...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    } catch (error) {
        console.error(`Error generating audio for ${language}:`, error);
        return null;
    }
}

/**
 * Process a pair of languages in parallel
 */
async function processLanguagesInPairs(translations, languages) {
    try {
        console.log(`Processing language pair: ${languages.join(', ')}`);
        
        // Generate audio for both languages in parallel
        const audioPromises = languages.map(async (lang) => {
            if (!translations[lang]) {
                console.log(`No translation found for ${lang}, skipping...`);
                return { [`${lang}_audio`]: null };
            }

            console.log(`Generating audio for ${lang}...`);
            const audioData = await generateAudio(translations[lang], lang);
            
            if (!audioData) {
                console.error(`Failed to generate audio for ${lang}`);
                return { [`${lang}_audio`]: null };
            }

            return { [`${lang}_audio`]: audioData };
        });

        // Wait for both audio generations to complete
        const results = await Promise.all(audioPromises);
        
        // Combine results into a single object
        return Object.assign({}, ...results);
    } catch (error) {
        console.error('Error processing language pair:', error);
        return {};
    }
}

/**
 * Save audio file to disk
 */
async function saveAudioFile(audioData, outputPath) {
    try {
        if (!audioData) {
            throw new Error('No audio data to save');
        }

        // Ensure directory exists
        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        
        await fs.writeFile(outputPath, audioData);
        console.log('✓ Saved audio file:', outputPath);
        return true;
    } catch (error) {
        console.error('Error saving audio file:', error);
        return false;
    }
}

// Validate API key on startup
validateApiKey().then(isValid => {
    if (!isValid) {
        console.error('Failed to validate Eleven Labs API key');
        process.exit(1);
    }
});

export { generateAudio, processLanguagesInPairs, saveAudioFile }; 