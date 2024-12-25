import fs from 'fs/promises';
import path from 'path';
import { watch } from 'fs';
import { generateAudio, processLanguagesInPairs, saveAudioFile } from './audioHandler.js';
import { targetLanguages } from './translationHandler.js';

// Organize languages into processing groups
const languageGroups = {
    // Main languages to process last
    lastGroup: ['English', 'Hindi'],
    
    // Other languages to process first (in pairs)
    firstGroups: [
        ['Tamil', 'Telugu'],
        ['Malayalam', 'Kannada'],
        ['Marathi', 'Gujarati'],
        ['Punjabi', 'Sanskrit'],
        ['French', 'Spanish'],
        ['Russian']  // Will be paired with next available language if needed
    ]
};

/**
 * Ensures audio directories exist
 */
async function ensureAudioDirectories(videoId) {
    try {
        const baseDir = process.cwd();
        const audioDir = path.join(baseDir, 'temp_files', videoId, 'FinalTranslatedAudio');
        
        console.log('Creating audio directory:', audioDir);

        // Create main audio directory
        await fs.mkdir(audioDir, { recursive: true });
        console.log('✓ Created main audio directory');

        // Create directory for each language
        for (const lang of targetLanguages) {
            const langDir = path.join(audioDir, lang.name);
            console.log('Creating language directory:', langDir);
            await fs.mkdir(langDir, { recursive: true });
            console.log('✓ Created directory for', lang.name);
        }

        // Create English directory
        const englishDir = path.join(audioDir, 'English');
        console.log('Creating English directory:', englishDir);
        await fs.mkdir(englishDir, { recursive: true });
        console.log('✓ Created English directory');

        return audioDir;
    } catch (error) {
        console.error('Error creating audio directories:', error);
        throw error;
    }
}

/**
 * Process a pair of languages for a fragment
 */
async function processLanguagePair(languages, fragmentPath, videoId) {
    try {
        console.log(`\nProcessing language pair: ${languages.join(', ')} for ${path.basename(fragmentPath)}`);
        
        const baseDir = process.cwd();
        const translations = {};

        // Read translation files for both languages
        for (const lang of languages) {
            const translationPath = path.join(
                baseDir, 'temp_files', videoId, 'FinalTranslatedText', 
                lang, path.basename(fragmentPath)
            );

            try {
                const content = await fs.readFile(translationPath, 'utf-8');
                const data = JSON.parse(content);
                translations[lang] = data.translation.text;
            } catch (error) {
                console.error(`Error reading translation for ${lang}:`, error);
                translations[lang] = null;
            }
        }

        // Generate audio for both languages
        const audioResults = await processLanguagesInPairs(translations, languages);

        // Save audio files
        const audioDir = path.join(baseDir, 'temp_files', videoId, 'FinalTranslatedAudio');
        
        for (const lang of languages) {
            const audioData = audioResults[`${lang}_audio`];
            if (audioData) {
                const outputPath = path.join(
                    audioDir, lang, 
                    `${path.basename(fragmentPath, '.json')}.wav`
                );
                await saveAudioFile(audioData, outputPath);
                console.log(`✓ Saved audio for ${lang}: ${path.basename(outputPath)}`);
            }
        }

        return true;
    } catch (error) {
        console.error('Error processing language pair:', error);
        return false;
    }
}

/**
 * Process a single fragment for all languages
 */
async function processFragment(fragmentPath, videoId) {
    console.log(`\n=== Processing fragment: ${path.basename(fragmentPath)} ===`);

    // Process first groups
    for (const pair of languageGroups.firstGroups) {
        if (pair.length === 2) {
            await processLanguagePair(pair, fragmentPath, videoId);
        } else if (pair.length === 1) {
            // Handle odd language out by pairing with first language from last group temporarily
            const tempPair = [pair[0], languageGroups.lastGroup[0]];
            await processLanguagePair(tempPair, fragmentPath, videoId);
        }
    }

    // Process last group (English and Hindi)
    await processLanguagePair(languageGroups.lastGroup, fragmentPath, videoId);
}

/**
 * Gets existing audio files to avoid reprocessing
 */
async function getExistingAudioFiles(audioDir) {
    try {
        const existingFiles = new Map();
        const englishDir = path.join(audioDir, 'English');
        
        try {
            const files = await fs.readdir(englishDir);
            files.forEach(file => {
                const match = file.match(/fragment-(\d+)\.wav$/);
                if (match) {
                    existingFiles.set(parseInt(match[1]), file);
                }
            });
        } catch (error) {
            // English directory might not exist yet
        }

        return existingFiles;
    } catch (error) {
        console.error('Error getting existing audio files:', error);
        return new Map();
    }
}

/**
 * Gets all available translation fragments
 */
async function getAllTranslationFragments(translationsDir) {
    try {
        const files = await fs.readdir(translationsDir);
        const fragments = new Map();
        
        files.forEach(file => {
            const match = file.match(/fragment-(\d+)\.json$/);
            if (match) {
                fragments.set(parseInt(match[1]), file);
            }
        });

        return fragments;
    } catch (error) {
        console.error('Error getting translation fragments:', error);
        return new Map();
    }
}

/**
 * Sets up audio generation watcher
 */
async function setupAudioWatcher(videoId) {
    try {
        console.log('\n=== Setting up Audio Generation Process ===');
        console.log('Video ID:', videoId);

        const baseDir = process.cwd();
        const translationsDir = path.join(baseDir, 'temp_files', videoId, 'FinalTranslatedText', 'English');
        console.log('Watching translations directory:', translationsDir);
        
        // Ensure audio directories exist
        const audioDir = await ensureAudioDirectories(videoId);
        console.log('✓ Audio directories created at:', audioDir);

        // Get existing audio files and available translations
        const existingFiles = await getExistingAudioFiles(audioDir);
        const availableTranslations = await getAllTranslationFragments(translationsDir);
        
        console.log('Found existing audio files:', Array.from(existingFiles.keys()));
        console.log('Found translation fragments:', Array.from(availableTranslations.keys()));

        // Process existing translations in sequential order
        try {
            const maxFragment = Math.max(...availableTranslations.keys());
            console.log(`Processing fragments from 0 to ${maxFragment}`);

            for (let i = 0; i <= maxFragment; i++) {
                if (availableTranslations.has(i) && !existingFiles.has(i)) {
                    console.log(`\nProcessing fragment ${i}`);
                    const translationPath = path.join(translationsDir, availableTranslations.get(i));
                    await processFragment(translationPath, videoId);
                    console.log(`✓ Completed processing fragment ${i}`);
                } else if (existingFiles.has(i)) {
                    console.log(`Skipping existing fragment ${i}`);
                } else {
                    console.log(`Missing translation for fragment ${i}`);
                }
            }
        } catch (error) {
            console.error('Error processing translations:', error);
        }

        // Watch for new translations
        console.log('\n=== Setting up Translation Watcher ===');
        const watcher = watch(translationsDir, { persistent: true });

        watcher.on('change', async (eventType, filename) => {
            const match = filename?.match(/fragment-(\d+)\.json$/);
            if (match) {
                const fragmentNum = parseInt(match[1]);
                console.log(`\nDetected new translation file: fragment-${fragmentNum}`);
                
                // Wait a bit to ensure file is completely written
                setTimeout(async () => {
                    if (!existingFiles.has(fragmentNum)) {
                        console.log(`Processing new fragment ${fragmentNum}`);
                        const translationPath = path.join(translationsDir, filename);
                        await processFragment(translationPath, videoId);
                        existingFiles.set(fragmentNum, filename.replace('.json', '.wav'));
                        console.log(`✓ Completed processing fragment ${fragmentNum}`);
                    } else {
                        console.log(`Fragment ${fragmentNum} already processed`);
                    }
                }, 1000);
            }
        });

        console.log('✓ Audio generation watcher setup complete');
        return watcher;
    } catch (error) {
        console.error('Error setting up audio watcher:', error);
        throw error;
    }
}

/**
 * Gets audio generation status
 */
async function getAudioStatus(videoId) {
    try {
        const baseDir = process.cwd();
        const translationsDir = path.join(baseDir, 'temp_files', videoId, 'FinalTranslatedText', 'English');
        const audioDir = path.join(baseDir, 'temp_files', videoId, 'FinalTranslatedAudio');

        // Count translation files
        const translationFiles = await fs.readdir(translationsDir)
            .then(files => files.filter(f => f.endsWith('.json')))
            .catch(() => []);

        // Get status for each language
        const languageStatus = {};
        for (const lang of [...targetLanguages, { name: 'English' }]) {
            const langDir = path.join(audioDir, lang.name);
            const audioFiles = await fs.readdir(langDir)
                .then(files => files.filter(f => f.endsWith('.wav')))
                .catch(() => []);
            
            languageStatus[lang.name] = {
                filesCount: audioFiles.length,
                progress: translationFiles.length ? (audioFiles.length / translationFiles.length) * 100 : 0
            };
        }

        return {
            totalTranslations: translationFiles.length,
            processedAudioFiles: Object.values(languageStatus)[0]?.filesCount || 0,
            overallProgress: translationFiles.length ? 
                (Object.values(languageStatus)[0]?.filesCount || 0) / translationFiles.length * 100 : 0,
            languageStatus,
            isComplete: translationFiles.length > 0 && 
                Object.values(languageStatus).every(s => s.filesCount === translationFiles.length)
        };
    } catch (error) {
        return {
            totalTranslations: 0,
            processedAudioFiles: 0,
            overallProgress: 0,
            languageStatus: {},
            isComplete: false,
            error: error.message
        };
    }
}

export { setupAudioWatcher, getAudioStatus }; 