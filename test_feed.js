const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--lang=en-US,en']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 2000 });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  
  console.log('Navigating to Good Financial Cents feed...');
  await page.goto('https://www.facebook.com/GoodFinancialCents', { waitUntil: 'networkidle2', timeout: 35000 });
  
  // Click See more
  await page.evaluate(() => {
    const seeMores = Array.from(document.querySelectorAll('div[role="button"]')).filter(el => (el.innerText || '').trim().toLowerCase() === 'see more');
    seeMores.forEach(el => el.click());
  });
  
  const posts = await page.evaluate(() => {
    const articles = Array.from(document.querySelectorAll('div[role="article"]'));
    const res = [];
    for (const art of articles) {
      // Find photo
      const img = art.querySelector('img[src*="scontent"], img[src*="fbcdn"]');
      if (!img) continue;
      
      // Find caption
      const textContainers = Array.from(art.querySelectorAll('div[dir="auto"]'));
      let fullCaption = '';
      for (const tc of textContainers) {
        if (tc.closest('[aria-label*="Comment"], [aria-label*="replies"]')) continue;
        const text = (tc.innerText || '').trim();
        if (text.length > fullCaption.length && !text.includes('All reactions:') && !text.includes('Write a comment')) {
          fullCaption = text;
        }
      }
      
      // Find author comment
      const commentNodes = Array.from(art.querySelectorAll('div[role="article"]'));
      let authorComment = null;
      for (const cn of commentNodes) {
        const cnText = cn.innerText || '';
        if (cnText.includes('Author') || cnText.includes('Good Financial Cents')) {
          const commentDivs = Array.from(cn.querySelectorAll('div[dir="auto"]'));
          for (const cd of commentDivs) {
            const cTxt = (cd.innerText || '').trim();
            if (cTxt && cTxt !== 'Author' && cTxt !== 'Good Financial Cents' && cTxt !== fullCaption && !cTxt.match(/^\d+[hmd]$/)) {
              authorComment = cTxt;
              break;
            }
          }
        }
      }
      
      const width = img.naturalWidth || img.width || 0;
      if (width > 250) {
        res.push({
          imgSrc: img.src,
          imgSize: `${img.naturalWidth || img.width}x${img.naturalHeight || img.height}`,
          caption: fullCaption.slice(0, 120),
          authorComment: authorComment
        });
      }
    }
    return res;
  });
  
  console.log('Feed photo posts found:', posts.length);
  for (let i = 0; i < Math.min(5, posts.length); i++) {
    console.log(`[#${i+1}] ${posts[i].imgSize} | Caption: ${posts[i].caption}`);
    if (posts[i].authorComment) console.log(`   Author Comment: ${posts[i].authorComment}`);
  }
  await browser.close();
})();
