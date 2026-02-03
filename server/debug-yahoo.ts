
import _YahooFinance from 'yahoo-finance2';
import fs from 'fs';

const yahooFinance = new _YahooFinance();

async function main() {
    const symbol = 'FBY';
    const log = (msg: string) => fs.appendFileSync('debug_output.txt', msg + '\n');
    fs.writeFileSync('debug_output.txt', 'Starting debug via instance...\n');

    try {
        log('Attempting historical fetch with period2...');
        const result = await yahooFinance.historical(symbol, {
            period1: '2000-01-01',
            period2: new Date().toISOString().split('T')[0], // Add explicit period2
            interval: '1d',
            events: 'dividends'
        });
        log(`Success! Items: ${result.length}`);
        if (result.length > 0) log(`First item: ${JSON.stringify(result[0])}`);

    } catch (err: any) {
        log('Caught error:');
        if (err.errors) {
            log(JSON.stringify(err.errors, null, 2));
        } else {
            log(String(err));
        }
    }
}

main();
