import fs from 'fs/promises';
import path from 'path';
import { generateAudio, processLanguagesInPairs, saveAudioFile } from './audioHandler.js';

class AudioSyncManager {
    constructor(videoId) {
        this.videoId = videoId;
        this.baseDir = process.cwd();
        this.audioDir = path.join(this.baseDir, 'temp_files', videoId, 'FinalTranslatedAudio');
        this.translationsDir = path.join(this.baseDir, 'temp_files', videoId, 'FinalTranslatedText');
        this.currentFragment = 0;
        this.isProcessing = false;
        this.languages = [
            // Active languages
            'Hindi',
            'Sanskrit',
            'Kannada',
            
            // Commented languages
            // 'English',
            // 'Tamil',
            // 'Telugu',
            // 'Malayalam',
            // 'Marathi',
            // 'Gujarati',
            // 'Punjabi',
            // 'French',
            // 'Spanish',
            // 'Russian'
        ];
    }

    /**
     * Check if all languages have processed a specific fragment
     */
    async isFragmentComplete(fragmentNum) {
        try {
            for (const lang of this.languages) {
                const audioPath = path.join(this.audioDir, lang, `fragment-${fragmentNum}.wav`);
                try {
                    await fs.access(audioPath);
                } catch {
                    return false;
                }
            }
            return true;
        } catch (error) {
            console.error(`Error checking fragment ${fragmentNum}:`, error);
            return false;
        }
    }

    /**
     * Get the next fragment that needs processing
     */
    async findNextFragment() {
        // Start checking from fragment 0
        let fragment = 0;
        
        // Keep checking each fragment in sequence
        while (true) {
            // Check if this fragment exists for all languages
            let isComplete = true;
            let hasAny = false;

            for (const lang of this.languages) {
                const audioPath = path.join(this.audioDir, lang, `fragment-${fragment}.wav`);
                try {
                    await fs.access(audioPath);
                    hasAny = true;  // At least one language has this fragment
                } catch {
                    isComplete = false;  // Missing for at least one language
                }
            }

            // If no language has this fragment and we've found files before,
            // we've reached the end
            if (!hasAny && fragment > 0) {
                // Go back to the last incomplete fragment
                while (fragment >= 0) {
                    let prevComplete = true;
                    for (const lang of this.languages) {
                        const audioPath = path.join(this.audioDir, lang, `fragment-${fragment}.wav`);
                        try {
                            await fs.access(audioPath);
                        } catch {
                            prevComplete = false;
                            break;
                        }
                    }
                    if (!prevComplete) {
                        return fragment;
                    }
                    fragment--;
                }
                return 0;  // If all previous are complete, start from 0
            }

            // If this fragment is not complete for all languages, this is the one to process
            if (!isComplete) {
                return fragment;
            }

            // Move to next fragment
            fragment++;
        }
    }

    /**
     * Check if translations exist for a fragment
     */
    async hasTranslations(fragmentNum) {
        try {
            // First check if any language has audio for a higher fragment number
            let maxFragment = -1;
            for (const lang of this.languages) {
                const langDir = path.join(this.audioDir, lang);
                try {
                    const files = await fs.readdir(langDir);
                    for (const file of files) {
                        const match = file.match(/fragment-(\d+)\.wav$/);
                        if (match) {
                            const num = parseInt(match[1]);
                            maxFragment = Math.max(maxFragment, num);
                        }
                    }
                } catch {
                    // Directory might not exist yet
                }
            }

            // If we're trying to process a fragment but have higher numbers,
            // force processing of the current fragment first
            if (maxFragment > fragmentNum) {
                console.log(`Found fragment ${maxFragment} but need to process ${fragmentNum} first`);
                // Check if translations exist for this fragment
                for (const lang of this.languages) {
                    const translationPath = path.join(
                        this.translationsDir, 
                        lang, 
                        `fragment-${fragmentNum}.json`
                    );
                    try {
                        await fs.access(translationPath);
                    } catch {
                        return false;
                    }
                }
                return true;
            }

            // Normal translation check
            for (const lang of this.languages) {
                const translationPath = path.join(
                    this.translationsDir, 
                    lang, 
                    `fragment-${fragmentNum}.json`
                );
                try {
                    await fs.access(translationPath);
                } catch {
                    return false;
                }
            }
            return true;
        } catch (error) {
            console.error(`Error checking translations for fragment ${fragmentNum}:`, error);
            return false;
        }
    }

    /**
     * Process a specific fragment for all languages
     */
    async processFragment(fragmentNum) {
        console.log(`\n🎯 Starting fragment ${fragmentNum} processing`);
        
        // Read all translations first
        const translations = {};
        let allTranslationsRead = true;
        
        for (const lang of this.languages) {
            try {
                const translationPath = path.join(
                    this.translationsDir,
                    lang,
                    `fragment-${fragmentNum}.json`
                );
                const content = await fs.readFile(translationPath, 'utf-8');
                const data = JSON.parse(content);
                translations[lang] = data.translation.text;
                console.log(`📖 Read translation for ${lang} fragment ${fragmentNum}`);
            } catch (error) {
                console.error(`❌ Error reading translation for ${lang}:`, error);
                allTranslationsRead = false;
                break;
            }
        }

        if (!allTranslationsRead) {
            console.error(`❌ Failed to read all translations for fragment ${fragmentNum}`);
            return false;
        }

        // Process languages strictly in sequence
        for (const lang of this.languages) {
            console.log(`\n🔄 Processing ${lang} fragment ${fragmentNum}`);
            
            // Keep trying until we succeed for this language
            while (true) {
                try {
                    // Check if file already exists
                    const audioPath = path.join(this.audioDir, lang, `fragment-${fragmentNum}.wav`);
                    try {
                        await fs.access(audioPath);
                        console.log(`✅ Already have audio for ${lang} fragment ${fragmentNum}`);
                        break; // Move to next language
                    } catch {
                        // File doesn't exist, proceed with generation
                    }

                    console.log(`🎵 Generating audio for ${lang} fragment ${fragmentNum}`);
                    const results = await processLanguagesInPairs(translations, [lang]);
                    const audioData = results[`${lang}_audio`];
                    
                    if (audioData) {
                        const success = await saveAudioFile(audioData, audioPath);
                        if (success) {
                            console.log(`✅ Saved audio for ${lang} fragment ${fragmentNum}`);
                            break; // Success! Move to next language
                        }
                    }
                    
                    throw new Error('Audio generation failed');
                } catch (error) {
                    console.error(`❌ Error processing ${lang} (retrying in 2s):`, error);
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    // Loop continues automatically
                }
            }
        }

        // Verify all languages have audio for this fragment
        let allComplete = true;
        for (const lang of this.languages) {
            const audioPath = path.join(this.audioDir, lang, `fragment-${fragmentNum}.wav`);
            try {
                await fs.access(audioPath);
                console.log(`✓ Verified ${lang} fragment ${fragmentNum} exists`);
            } catch {
                console.error(`❌ Missing audio for ${lang} fragment ${fragmentNum}`);
                allComplete = false;
            }
        }

        if (allComplete) {
            console.log(`\n🎉 Successfully completed fragment ${fragmentNum} for all languages!`);
            return true;
        } else {
            console.error(`❌ Fragment ${fragmentNum} verification failed, will retry`);
            return false;
        }
    }

    /**
     * Start the synchronization process
     */
    async start() {
        if (this.isProcessing) {
            console.log('Already processing...');
            return;
        }

        this.isProcessing = true;
        console.log('\n=== Starting Audio Sync Manager ===');

        try {
            let currentFragment = 0;
            while (true) {
                // Always process fragments sequentially
                console.log(`\n🔍 Checking fragment ${currentFragment}`);
                
                // Check if translations exist for this fragment
                if (await this.hasTranslations(currentFragment)) {
                    let success = false;
                    while (!success) {
                        console.log(`\n🎯 Processing fragment ${currentFragment}`);
                        success = await this.processFragment(currentFragment);
                        
                        if (!success) {
                            console.log(`⏳ Retrying fragment ${currentFragment} in 2 seconds...`);
                            await new Promise(resolve => setTimeout(resolve, 2000));
                        }
                    }
                    
                    console.log(`✨ Fragment ${currentFragment} fully completed, moving to next`);
                    currentFragment++;
                } else {
                    // No translations available for current fragment
                    console.log(`⏳ Waiting for translations for fragment ${currentFragment}...`);
                    await new Promise(resolve => setTimeout(resolve, 5000));
                }
            }
        } catch (error) {
            console.error('❌ Error in sync manager:', error);
        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * Get current progress
     */
    async getProgress() {
        const progress = {
            currentFragment: this.currentFragment,
            languageProgress: {}
        };

        for (const lang of this.languages) {
            try {
                const langDir = path.join(this.audioDir, lang);
                const files = await fs.readdir(langDir);
                progress.languageProgress[lang] = files.length;
            } catch (error) {
                progress.languageProgress[lang] = 0;
            }
        }

        return progress;
    }
}

export default AudioSyncManager; 