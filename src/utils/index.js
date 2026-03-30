const moment = require('moment');
const { loadSettings } = require('../../settings');
const settings = loadSettings();
const sgMail = require('@sendgrid/mail');

const PROJECT_NAME = 'crypto-populators-position-limit';

sgMail.setApiKey(settings.sendgrid_api_key)

function logWithTimestamp(message) {
    console.log(`${moment().utc().format('YYYY-MM-DD HH:mm:ss.SSS')} [${PROJECT_NAME}] - ${message}`);
}

async function withRetries(fn, retries = 5, delay = 2000) {
    while (retries > 0) {
        try {
            return await fn();
        } catch (error) {
            retries--;
            if (retries <= 0) {
                const errorMessage = `Retry error: ${error.message}`
                handleError(errorMessage, true);
                throw error;
            }
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

const debounceTime = 5000; // 5 seconds
let errorQueue = [];
let lastEmailTime = 0;
let emailTimeout = null;

async function processErrorQueue() {
    if (errorQueue.length > 0) {
        const now = Date.now();
        if (lastEmailTime + debounceTime <= now) {
            logWithTimestamp('Processing error queue...');

            // Combine error messages for the email
            const combinedMessages = errorQueue.reduce((acc, { error, timestamp }) => {
                return acc + `${moment(timestamp).utc().format('YYYY-MM-DD HH:mm:ss.SSS')} [${PROJECT_NAME}] - ${error}\n`;
            }, '');

            try {
                await sgMail.send({
                    to: 'daniel@ardaga.xyz',
                    from: 'errors@ardaga.xyz',
                    subject: `Error Report - ${PROJECT_NAME}`,
                    text: combinedMessages
                });
                logWithTimestamp('Error email sent.');
            } catch (error) {
                logWithTimestamp('Failed to send error email.');
                console.error(error);
            }

            // Reset the state
            lastEmailTime = now;
            errorQueue = [];
            clearTimeout(emailTimeout);
            emailTimeout = null;
        } else if (!emailTimeout) {
            // Schedule the next attempt if not already scheduled
            emailTimeout = setTimeout(processErrorQueue, lastEmailTime + debounceTime - now);
        }
    } else {
        logWithTimestamp('Error queue is empty.');
    }
}

async function handleError(error, sendEmail = false) {
    console.error(error);
    const timestamp = Date.now();
    logWithTimestamp(`Error handler: ${error}`);

    if (sendEmail) {
        errorQueue.push({ error, timestamp });

        if (!emailTimeout) {
            // If there is no pending process, schedule one immediately
            emailTimeout = setTimeout(processErrorQueue, debounceTime);
        }
    }
}

function sanitizeAssetName(asset) {
    if (!asset) return;
    return asset
        .replace(/xbt/gi, 'btc') // Replace 'xbt' or 'XBT' with 'BTC', case-insensitive
        .replace(/_/g, '') // Remove all underscores
        .replace(/-/g, '') // Remove all hyphens/dashes
        .replace(/ /g, '') // Remove all spaces
        // Remove specific strings of numbers
        .replace(/10000000/g, '')
        .replace(/1000000/g, '')
        .replace(/100000/g, '')
        .replace(/10000/g, '')
        .replace(/1000/g, '')
        .replace(/100/g, '')
        .replace(/10/g, '')
        .toUpperCase(); // Convert to upper case at the end
}

module.exports = {
    withRetries,
    logWithTimestamp,
    handleError,
    sanitizeAssetName
}
