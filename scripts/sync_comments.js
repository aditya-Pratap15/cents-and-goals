#!/usr/bin/env node
/**
 * 💬 CENTS & GOALS - AUTHOR COMMENT SYNCRONIZER
 * --------------------------------------------
 * When scheduled posts go live on the Facebook Page, this bot posts the
 * author's comment (if any was captured during Phase 1 ingestion) under the post.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const BASE_DIR = path.resolve(__dirname, '..');
const STATE_FILE = path.join(BASE_DIR, 'scheduled_posts_state.json');

const FB_PAGE_ACCESS_TOKEN = (process.env.FB_PAGE_ACCESS_TOKEN || 'EAGTdtKs0KI8BSz0uZB5TRh7wb8JhSUtIpQVVR47WoOoobybBYD5YQVPvrVkXoBJOHU9ktzZCZB143Bcwx2RoY3aLbCNHteqzIvSymzWAsT92qaCx9erwEi5L6Y19Jv0xKKvLEZBfZA2ruxinOqxLsIy5C899EuGTxrIig6vDatZBHIezyAmjo9XMaQ63zTKjZCQRHxV').trim();

function postComment(targetId, message) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      message: message,
      access_token: FB_PAGE_ACCESS_TOKEN
    });

    const req = https.request({
      hostname: 'graph.facebook.com',
      path: `/v26.0/${targetId}/comments`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (json.error) {
            reject(new Error(`FB Graph API Error: ${JSON.stringify(json.error)}`));
          } else {
            resolve(json);
          }
        } catch (e) {
          reject(new Error(`Invalid JSON: ${body}`));
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function syncComments() {
  console.log('===============================================================');
  console.log('💬 CENTS & GOALS: COMMENT SYNCRONIZER');
  console.log('===============================================================\n');

  if (!fs.existsSync(STATE_FILE)) {
    console.log('No scheduled_posts_state.json found. Skipping comment sync.');
    return;
  }

  const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  const posts = state.posts || [];
  const nowUnix = Math.floor(Date.now() / 1000);

  let updated = false;

  for (const post of posts) {
    if (!post.authorComment) continue;
    if (post.commentPosted) continue;

    // Check if scheduled time has passed
    if (post.scheduledUnix && nowUnix >= post.scheduledUnix) {
      const targetId = post.fbPostId || post.fbPhotoId;
      if (!targetId) continue;

      console.log(`Posting author comment to target ${targetId}...`);
      try {
        const res = await postComment(targetId, post.authorComment);
        console.log(`✅ Comment posted! Comment ID: ${res.id}`);
        post.commentPosted = true;
        post.commentId = res.id;
        post.commentPostedAt = new Date().toISOString();
        updated = true;
      } catch (err) {
        console.error(`⚠️ Failed to post comment to ${targetId}:`, err.message);
      }
    } else {
      console.log(`Post ${post.index} scheduled for ${post.scheduledTimeUTC} has not published yet.`);
    }
  }

  if (updated) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    console.log(`Updated state file.`);
  }

  console.log('\nComment sync pass complete.');
}

if (require.main === module) {
  syncComments().catch(console.error);
}

module.exports = { syncComments };
