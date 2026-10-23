const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1800 });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
  
  await page.goto('https://www.facebook.com/GoodFinancialCents/posts/pfbid02yFdpt1X58gT3ddkhSmm98SkTR8bgEewZCuoHE6qojdh1j1KAhJuGNqamBfMRzjpTl', { waitUntil: 'networkidle2', timeout: 35000 });
  
  const postInfo = await page.evaluate(() => {
    // 1. Text caption
    const textDivs = Array.from(document.querySelectorAll('div[dir="auto"]')).map(d => d.innerText.trim()).filter(t => t.length > 40);
    // 2. Img
    const img = document.querySelector('img[src*="fbcdn"], img[src*="scontent"]');
    // 3. Comments
    const comments = Array.from(document.querySelectorAll('div[role="article"]')).map(c => c.innerText).filter(t => t.includes('Good Financial Cents') || t.includes('Author'));
    return {
      caption: textDivs[0] || '',
      img: img ? img.src : '',
      comments: comments
    };
  });
  
  console.log('Post permalink Caption:', postInfo.caption.slice(0, 150));
  console.log('Post permalink Img:', postInfo.img.slice(0, 80));
  console.log('Post permalink Comments:', postInfo.comments);
  await browser.close();
})();
