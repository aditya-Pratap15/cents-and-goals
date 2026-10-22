#!/usr/bin/env node
/**
 * 🚀 CENTS & GOALS - FACEBOOK PUBLISHER & SCHEDULER BOT (PHASE 3)
 * -------------------------------------------------------------
 * 1. Fetches transformed posts and cleaned photos from Google Drive "after" subfolder
 *    via Google Apps Script Web App.
 * 2. Checks/validates the 5 posts.
 * 3. Calculates 5 peak USA EDT scheduling slots (offset by 5-10 minutes to avoid congestion):
 *      Slot 1: 08:35 AM EDT (18:05 IST) - Morning Commute
 *      Slot 2: 11:35 AM EDT (21:05 IST) - Midday Break
 *      Slot 3: 01:35 PM EDT (23:05 IST) - Lunch Peak
 *      Slot 4: 04:35 PM EDT (02:05 IST +1) - Afternoon Commute
 *      Slot 5: 07:35 PM EDT (05:05 IST +1) - Evening Primetime
 * 4. Uploads photos + scheduled_publish_time + published: false to Facebook Graph API:
 *      POST https://graph.facebook.com/v26.0/{PAGE_ID}/photos
 * 5. Saves schedule state mapping (for comment sync or auditing).
 * 6. CRITICAL RULE: Calls Google Apps Script with action="clean_after" to wipe the "after"
 *    folder so it is 100% clean and ready for tomorrow's run!
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const BASE_DIR = path.resolve(__dirname, '..');
const STATE_FILE = path.join(BASE_DIR, 'scheduled_posts_state.json');

// Configuration & Credentials
const APPS_SCRIPT_URL = (process.env.APPS_SCRIPT_URL || 'https://script.google.com/macros/s/AKfycby5sEQrjWJpgMRsSEP3utqrTMFWJgVoyLKs-CsI3hEbRNQlNae70S9hp54ophlVY4_6ng/exec').trim();
const FB_PAGE_ID = (process.env.FB_PAGE_ID || '1403808602812144').trim();
const FB_PAGE_ACCESS_TOKEN = (process.env.FB_PAGE_ACCESS_TOKEN || 'EAGTdtKs0KI8BSz0uZB5TRh7wb8JhSUtIpQVVR47WoOoobybBYD5YQVPvrVkXoBJOHU9ktzZCZB143Bcwx2RoY3aLbCNHteqzIvSymzWAsT92qaCx9erwEi5L6Y19Jv0xKKvLEZBfZA2ruxinOqxLsIy5C899EuGTxrIig6vDatZBHIezyAmjo9XMaQ63zTKjZCQRHxV').trim();

// Target USA Peak Times (EDT is UTC-4).
// Hours and minutes in 24h EDT:
const PEAK_SLOTS_EDT = [
  { hour: 8, minute: 35, name: 'Morning Commute' },
  { hour: 11, minute: 35, name: 'Midday Break' },
  { hour: 13, minute: 35, name: 'Lunch Peak' },
  { hour: 16, minute: 35, name: 'Afternoon Commute' },
  { hour: 19, minute: 35, name: 'Evening Primetime' }
];

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchJson(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve({ raw: data });
        }
      });
    }).on('error', reject);
  });
}

function postJson(url, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const parsed = new URL(url);
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchJson(res.headers.location).then(resolve).catch(reject);
      }
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { resolve({ raw: body }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

/**
 * Calculates schedule UNIX timestamp for today or tomorrow in EDT (UTC-4)
 * Facebook requires scheduled_publish_time to be between 10 minutes and 75 days in the future.
 */
function getNextSlotUnixTimestamp(slotHour, slotMinute) {
  const now = new Date();
  
  // Calculate target time in UTC
  // EDT is UTC - 4 hours. So UTC hour = slotHour + 4
  const targetUtc = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    slotHour + 4,
    slotMinute,
    0,
    0
  ));

  // If slot has already passed or is less than 15 minutes away, schedule for tomorrow
  const minFutureTime = now.getTime() + (15 * 60 * 1000);
  if (targetUtc.getTime() <= minFutureTime) {
    targetUtc.setUTCDate(targetUtc.getUTCDate() + 1);
  }

  return Math.floor(targetUtc.getTime() / 1000);
}

/**
 * Uploads scheduled photo to Facebook Page Graph API
 */
async function scheduleFacebookPhoto(photoBase64, caption, unixTimestamp) {
  return new Promise((resolve, reject) => {
    const boundary = '----FBBoundary' + Date.now();
    const photoBuffer = Buffer.from(photoBase64, 'base64');

    let bodyParts = [];

    // published = false
    bodyParts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="published"\r\n\r\nfalse\r\n`));
    
    // scheduled_publish_time
    bodyParts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="scheduled_publish_time"\r\n\r\n${unixTimestamp}\r\n`));

    // caption / message
    bodyParts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption}\r\n`));

    // access_token
    bodyParts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="access_token"\r\n\r\n${FB_PAGE_ACCESS_TOKEN}\r\n`));

    // source (photo binary)
    bodyParts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="source"; filename="post.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`));
    bodyParts.push(photoBuffer);
    bodyParts.push(Buffer.from(`\r\n--${boundary}--\r\n`));

    const fullPayload = Buffer.concat(bodyParts);

    const options = {
      hostname: 'graph.facebook.com',
      path: `/v26.0/${FB_PAGE_ID}/photos`,
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': fullPayload.length
      }
    };

    const req = https.request(options, res => {
      let resBody = '';
      res.on('data', c => resBody += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(resBody);
          if (json.error) {
            reject(new Error(`FB Graph API Error: ${JSON.stringify(json.error)}`));
          } else {
            resolve(json);
          }
        } catch (e) {
          reject(new Error(`Invalid JSON response: ${resBody}`));
        }
      });
    });

    req.on('error', reject);
    req.write(fullPayload);
    req.end();
  });
}

async function runScheduler() {
  console.log('===============================================================');
  console.log('🚀 CENTS & GOALS: SCHEDULING 5 POSTS (PHASE 3)');
  console.log('===============================================================\n');

  console.log(`Checking Google Drive "after" folder via Apps Script...`);
  const checkUrl = `${APPS_SCRIPT_URL}?action=get_after`;
  const driveData = await fetchJson(checkUrl);

  if (!driveData.success) {
    throw new Error(`Failed to read "after" folder: ${JSON.stringify(driveData)}`);
  }

  console.log(`Found ${driveData.count || 0} files in "after" folder.`);

  let metadata = driveData.metadata;
  const files = driveData.files || [];

  if (!metadata) {
    // If metadata was not parsed automatically, look for today_transformed.json or today_raw_posts.json
    const metaFile = files.find(f => f.name.endsWith('.json'));
    if (metaFile) {
      console.log(`Fetching metadata JSON from file ID: ${metaFile.id} (${metaFile.name})`);
      const dlUrl = `${APPS_SCRIPT_URL}?action=download&fileId=${metaFile.id}`;
      const fileData = await fetchJson(dlUrl);
      if (fileData.base64) {
        metadata = JSON.parse(Buffer.from(fileData.base64, 'base64').toString('utf8'));
      }
    }
  }

  if (!metadata || !metadata.posts || metadata.posts.length === 0) {
    console.log('⚠️ No transformed posts found in "after" subfolder to schedule.');
    console.log('Please ensure Phase 2 (Gemini Transformation) has completed and uploaded files.');
    return;
  }

  const posts = metadata.posts;
  console.log(`Found ${posts.length} posts to schedule.\n`);

  const scheduledResults = [];

  for (let i = 0; i < posts.length && i < PEAK_SLOTS_EDT.length; i++) {
    const post = posts[i];
    const slot = PEAK_SLOTS_EDT[i];
    const scheduleUnix = getNextSlotUnixTimestamp(slot.hour, slot.minute);
    const scheduleDateStr = new Date(scheduleUnix * 1000).toUTCString();

    console.log(`---------------------------------------------------------------`);
    console.log(`[Post ${i + 1}/${posts.length}] Target Slot: ${slot.name} (${slot.hour}:${slot.minute} EDT)`);
    console.log(`Scheduled Time (UTC): ${scheduleDateStr}`);

    // Caption priority: viralCaption > transformedCaption > caption > headline
    const finalCaption = post.viralCaption || post.transformedCaption || post.caption || post.headline || 'Cents & Goals';

    // Find photo file in Drive
    const targetFilename = post.cleanedFilename || post.filename;
    let photoBase64 = null;

    const matchingDriveFile = files.find(f => f.name === targetFilename || f.name.includes(`post_${post.index || (i+1)}`));
    if (matchingDriveFile) {
      console.log(`Downloading photo from Drive: ${matchingDriveFile.name} (${matchingDriveFile.id})`);
      const dlData = await fetchJson(`${APPS_SCRIPT_URL}?action=download&fileId=${matchingDriveFile.id}`);
      if (dlData.base64) {
        photoBase64 = dlData.base64;
      }
    }

    if (!photoBase64) {
      console.warn(`⚠️ Could not find base64 photo for Post ${i + 1} (${targetFilename}). Skipping.`);
      continue;
    }

    try {
      console.log(`Scheduling to Facebook Page (${FB_PAGE_ID})...`);
      const fbRes = await scheduleFacebookPhoto(photoBase64, finalCaption, scheduleUnix);
      console.log(`✅ Post ${i + 1} Scheduled Successfully! Photo ID: ${fbRes.id}, Post ID: ${fbRes.post_id || 'N/A'}`);

      scheduledResults.push({
        index: i + 1,
        fbPhotoId: fbRes.id,
        fbPostId: fbRes.post_id || null,
        scheduledUnix: scheduleUnix,
        scheduledTimeUTC: scheduleDateStr,
        authorComment: post.authorComment || null,
        captionSnippet: finalCaption.slice(0, 80) + '...'
      });
    } catch (err) {
      console.error(`❌ Failed to schedule Post ${i + 1}:`, err.message);
    }
  }

  // Save state locally
  fs.writeFileSync(STATE_FILE, JSON.stringify({
    scheduledAt: new Date().toISOString(),
    scheduledCount: scheduledResults.length,
    posts: scheduledResults
  }, null, 2));
  console.log(`\n💾 Saved schedule state to ${STATE_FILE}`);

  // CRITICAL STEP: Clear the "after" subfolder so it is clean for next day
  console.log('\n🧹 Clearing "after" subfolder in Google Drive as required...');
  try {
    const cleanRes = await postJson(APPS_SCRIPT_URL, { action: 'clean_after' });
    console.log(`✅ Google Drive "after" folder cleaned:`, cleanRes.message || cleanRes);
  } catch (cleanErr) {
    console.error(`⚠️ Failed to clean "after" subfolder:`, cleanErr.message);
  }

  console.log('\n🎉 PHASE 3 SCHEDULER BOT COMPLETE!');
}

if (require.main === module) {
  runScheduler().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}

module.exports = { runScheduler };
