import OpenAI from 'openai';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';

dotenv.config();

// Initialize OpenAI
if (!process.env.OPENAI_API_KEY) {
    console.error('Error: OPENAI_API_KEY is not set in environment variables');
    process.exit(1);
}

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// Constants
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second
const MAX_TEXT_LENGTH = 4000; // Characters
const GPT_COST_PER_1K_TOKENS = 0.002;

// List of target languages with codes
const targetLanguages = [
    { name: "Hindi", code: "hi" },
    { name: "Marathi", code: "mr" },
    { name: "Gujarati", code: "gu" },
    { name: "Tamil", code: "ta" },
    { name: "Telugu", code: "te" },
    { name: "Malayalam", code: "ml" },
    { name: "Kannada", code: "kn" },
    { name: "Punjabi", code: "pa" },
    { name: "French", code: "fr" },
    { name: "Russian", code: "ru" },
    { name: "Spanish", code: "es" },
    { name: "Sanskrit", code: "sa" }
];

/**
 * Validates and sanitizes input text
 * @param {string} text - The input text to validate
 * @returns {string} - Sanitized text
 * @throws {Error} - If text is invalid
 */
function validateInput(text) {
    // Check if text is provided and is a string
    if (!text || typeof text !== 'string') {
        throw new Error('Input text must be a non-empty string');
    }

    // Remove potentially harmful characters, keeping only letters, numbers, punctuation, and spaces
    text = text.replace(/[^\p{L}\p{N}\p{P}\p{Z}]/gu, '');

    // Check if text is within length limits
    if (text.length > MAX_TEXT_LENGTH) {
        throw new Error(`Text exceeds maximum length of ${MAX_TEXT_LENGTH} characters`);
    }

    // Check if text contains valid characters
    if (text.trim().length === 0) {
        throw new Error('Text contains no valid characters');
    }

    return text;
}

/**
 * Detects the language of input text using GPT-3.5
 * @param {string} text - Text to analyze
 * @returns {Object} - Detected language info and token usage
 */
async function detectLanguage(text) {
    // Prepare messages for GPT-3.5
    const messages = [
        {
            "role": "system",
            "content": "You are a language detector. Return only a JSON response with the detected language name and confidence score."
        },
        {
            "role": "user",
            "content": `Detect the language of this text:\n${text}`
        }
    ];

    // Make API call with specific parameters
    const completion = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: messages,
        temperature: 0,           // Use deterministic output
        max_tokens: 800           // Limit response length
    });

    return {
        detectedLanguage: completion.choices[0].message.content,
        usage: completion.usage
    };
}

/**
 * Implements retry logic for API calls
 * @param {Function} operation - Async function to retry
 * @param {number} retries - Number of retry attempts
 * @returns {Promise} - Result of the operation
 */
async function withRetry(operation, retries = MAX_RETRIES) {
    for (let i = 0; i < retries; i++) {
        try {
            return await operation();
        } catch (error) {
            if (i === retries - 1) throw error;  // If last retry, throw error
            console.log(`Attempt ${i + 1} failed, retrying in ${RETRY_DELAY}ms...`);
            // Wait with exponential backoff
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * (i + 1)));
        }
    }
}

/**
 * Translates text to English
 * @param {string} originalText - Text to translate
 * @returns {Promise<Object>} - English translation and usage metrics
 */
async function getEnglishTranslation(originalText) {
    // Prepare messages for GPT-3.5
    const messages = [
        {
            "role": "system",
            "content": `You are a translator. Return only the English translation, without adding any extra meanings or commentary.
Rules:
1. Output must be valid JSON only, with the structure: {"English": "text"}
2. Be concise and faithful to the original.
3. No extra text outside the JSON.
4. Preserve formatting and punctuation.
5. Maintain the original tone and style.`
        },
        {
            "role": "user",
            "content": `Translate to English only:\n${originalText}`
        }
    ];

    // Use retry wrapper for API call
    return await withRetry(async () => {
        const completion = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: messages,
            temperature: 0.1,     // Slight variation allowed
            max_tokens: 500      // Allow longer translations
        });

        const response = completion.choices[0].message.content.trim();
        const parsed = JSON.parse(response);

        return {
            text: parsed.English,
            usage: completion.usage
        };
    });
}

/**
 * Translates English text to a target language
 * @param {string} englishText - Text to translate
 * @param {Object} language - Target language info
 * @returns {Promise<Object>} - Translation and usage metrics
 */
async function getSingleLanguageTranslation(englishText, language) {
    // Prepare messages for GPT-3.5
    const messages = [
        {
            "role": "system",
            "content": `You are a translator. Translate the English text into ${language.name}.
Rules:
1. Output valid JSON only, with structure: {"${language.name}": "text"}
2. Be concise and accurate.
3. Preserve cultural context and idioms appropriately.
4. Maintain formatting and punctuation.
5. Consider regional variations and formal/informal tone.`
        },
        {
            "role": "user",
            "content": `Translate this English text to ${language.name}:\n${englishText}`
        }
    ];

    // Use retry wrapper for API call
    return await withRetry(async () => {
        const completion = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: messages,
            temperature: 0.1,
            max_tokens: 800
        });

        const response = completion.choices[0].message.content.trim();
        const parsed = JSON.parse(response);

        return {
            text: parsed[language.name],
            usage: completion.usage,
            languageCode: language.code
        };
    });
}

/**
 * Main translation function that handles the entire translation process
 * @param {string} originalText - Text to translate
 * @returns {Promise<Object>} - All translations and metrics
 */
async function translateText(originalText) {
    const startTime = Date.now();
    let totalTokens = 0;
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;

    try {
        // Step 1: Validate input text
        originalText = validateInput(originalText);

        // Step 2: Detect original language
        const languageDetection = await detectLanguage(originalText);
        totalTokens += languageDetection.usage.total_tokens;

        // Step 3: Get English translation
        const englishResult = await getEnglishTranslation(originalText);
        const englishTranslation = englishResult.text;
        
        // Track token usage
        totalTokens += englishResult.usage.total_tokens;
        totalPromptTokens += englishResult.usage.prompt_tokens;
        totalCompletionTokens += englishResult.usage.completion_tokens;

        // Step 4: Translate to all target languages in parallel
        const translationPromises = targetLanguages.map(lang =>
            getSingleLanguageTranslation(englishTranslation, lang)
                .then(result => {
                    // Track token usage for each translation
                    totalPromptTokens += result.usage.prompt_tokens;
                    totalCompletionTokens += result.usage.completion_tokens;
                    totalTokens += result.usage.total_tokens;
                    return { 
                        [lang.name]: {
                            text: result.text,
                            languageCode: result.languageCode
                        }
                    };
                })
                .catch(error => {
                    console.error(`Translation failed for ${lang.name}:`, error.message);
                    return { [lang.name]: null };
                })
        );

        // Wait for all translations to complete
        const translations = await Promise.all(translationPromises);
        const endTime = Date.now();

        // Combine all translations into final result
        const allTranslations = {
            original: {
                text: originalText,
                detectedLanguage: languageDetection.detectedLanguage
            },
            English: {
                text: englishTranslation,
                languageCode: 'en'
            },
            ...Object.assign({}, ...translations)
        };

        // Return translations and metrics
        return {
            translations: allTranslations,
            metrics: {
                translationTime: (endTime - startTime) / 1000,  // Time in seconds
                promptTokens: totalPromptTokens,
                completionTokens: totalCompletionTokens,
                totalTokens: totalTokens,
                gptCost: (totalTokens / 1000) * GPT_COST_PER_1K_TOKENS,
                characterCount: originalText.length
            }
        };
    } catch (error) {
        console.error('Translation process failed:', error);
        throw error;
    }
}

export { translateText, targetLanguages }; 