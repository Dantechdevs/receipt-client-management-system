const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function chunkToWords(n) {
  let str = '';
  if (n >= 100) {
    str += ONES[Math.floor(n / 100)] + ' Hundred ';
    n %= 100;
  }
  if (n >= 20) {
    str += TENS[Math.floor(n / 10)] + ' ';
    n %= 10;
  }
  if (n > 0) {
    str += ONES[n] + ' ';
  }
  return str.trim();
}

// Converts a number into words suitable for an "Amount in Words" line, e.g.
// 1757400 -> "One Million Seven Hundred Fifty Seven Thousand Four Hundred"
function numberToWords(num) {
  num = Math.round(Math.abs(num || 0));
  if (num === 0) return 'Zero';

  const billions = Math.floor(num / 1e9);
  const millions = Math.floor((num % 1e9) / 1e6);
  const thousands = Math.floor((num % 1e6) / 1e3);
  const remainder = num % 1000;

  let parts = [];
  if (billions) parts.push(chunkToWords(billions) + ' Billion');
  if (millions) parts.push(chunkToWords(millions) + ' Million');
  if (thousands) parts.push(chunkToWords(thousands) + ' Thousand');
  if (remainder) parts.push(chunkToWords(remainder));

  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

// Full "Amount in Words" line including currency and cents, e.g.
// amountInWordsLine(1757400.50, 'KES') -> "Kenyan Shillings One Million ... Four Hundred and 50/100 Only"
function amountInWordsLine(amount, currency) {
  const whole = Math.floor(Math.abs(amount || 0));
  const cents = Math.round((Math.abs(amount || 0) - whole) * 100);
  const words = numberToWords(whole);
  const currencyLabel = currency || 'KES';
  const centsPart = cents > 0 ? ` and ${String(cents).padStart(2, '0')}/100` : '';
  return `${currencyLabel} ${words}${centsPart} Only`;
}

module.exports = { numberToWords, amountInWordsLine };
