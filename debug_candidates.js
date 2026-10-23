const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1800 });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
  
  await page.goto('https://www.facebook.com/photo.php?fbid=1937956144196762&set=pb.100039471860412.-2207520000&type=3', { waitUntil: 'networkidle2', timeout: 35000 });
  
  const textElements = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('div[dir="auto"], span[dir="auto"]'))
      .map(el => el.innerText.trim())
      .filter(t => t.length > 25);
  });
  
  const cleanCandidates = textElements.filter(t => {
    return !t.startsWith('Log in') &&
           !t.startsWith('See more on Facebook') &&
           !t.startsWith('Create new account') &&
           !t.startsWith('Forgot password') &&
           !t.startsWith('View more comments') &&
           !t.startsWith('Write a comment') &&
           !t.includes('All reactions:') &&
           !t.includes('Like\nComment') &&
           !t.match(/^\d+[hmdw]$/);
  });
  
  console.log('Clean candidates count:', cleanCandidates.length);
  cleanCandidates.forEach((c, idx) => {
    console.log(`[${idx + 1}] (len=${c.length}): ${c.slice(0, 100).replace(/\n/g, ' ')}`);
  });
  
  cleanCandidates.sort((a, b) => b.length - a.length);
  console.log('\nLONGEST CANDIDATE:\n', cleanCandidates[0]);
  
  await browser.close();
})();
