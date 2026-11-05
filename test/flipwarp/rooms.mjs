// Rooms, from end to end: one browser hosts, another joins with the invite
// link, and everything a room promises is checked between the two.
//
// It goes through the real public matchmaking server (0.peerjs.com), so it
// needs the internet, and it uses two separate browser profiles so the two
// players are as separate as two computers.
//
//     npm run build
//     (cd build && python3 -m http.server 8099)
//     node test/flipwarp/rooms.mjs
//
// SHOTS=<folder> also saves screenshots of the dialog there.
import path from 'node:path';
import {launchBrowser, SITE} from './launch.mjs';

let failures = 0;
const check = (ok, what, detail) => {
    if (!ok) failures++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
    if (!ok && detail !== undefined) console.log(`       ${JSON.stringify(detail)}`);
};

const browser = await launchBrowser();
const hostContext = await browser.newContext({viewport: {width: 1280, height: 800}});
const guestContext = await browser.newContext({viewport: {width: 1100, height: 800}});
const host = await hostContext.newPage();
const guest = await guestContext.newPage();
const shots = process.env.SHOTS;
const shot = async (page, name) => {
    if (shots) await page.screenshot({path: path.join(shots, `${name}.png`)});
};

const menuLabel = page => page.evaluate(() => {
    const item = [...document.querySelectorAll('[class*=menu-bar_menu-bar-item]')]
        .find(e => /Play with friends|^Room |Connecting/.test(e.textContent.trim()));
    return item ? item.textContent.trim() : null;
});
const waitFor = async (fn, ms = 30000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        const v = await fn();
        if (v) return v;
        await new Promise(r => setTimeout(r, 250));
    }
    return null;
};
const cloud = page => page.evaluate(() => {
    const stage = window.vm.runtime.getTargetForStage();
    const out = {};
    Object.values(stage.variables).filter(v => v.isCloud)
        .forEach(v => {
            out[v.name] = v.value;
        });
    return out;
});
const clickButton = (page, text) => page.evaluate(t => {
    const b = [...document.querySelectorAll('button')].find(e => e.textContent.trim() === t);
    if (!b) throw new Error(`no button "${t}"`);
    b.click();
}, text);

try {
    // --- the host opens a room ------------------------------------------------
    await host.goto(`${SITE}/editor.html`);
    await host.waitForFunction(() => window.vm && window.vm.runtime.getTargetForStage(), null, {timeout: 60000});
    await host.evaluate(() => {
        const stage = window.vm.runtime.getTargetForStage();
        stage.createVariable('score', '☁ score', '', true);
        stage.variables.score.value = 5;
    });
    await host.evaluate(() => {
        [...document.querySelectorAll('[class*=menu-bar_menu-bar-item]')]
            .find(e => e.textContent.trim() === 'Play with friends')
            .click();
    });
    await shot(host, 'rooms-start');
    await clickButton(host, 'Host a room');
    const hosting = await waitFor(async () => {
        const label = await menuLabel(host);
        return /^Room [A-Z0-9]{5} \(1\)$/.test(label || '') && label;
    });
    check(!!hosting, 'the host gets a room code', await menuLabel(host));
    const code = hosting ? hosting.slice(5, 10) : 'XXXXX';
    await shot(host, 'rooms-hosting');

    // --- a friend joins with the link -----------------------------------------
    await guest.goto(`${SITE}/?room=${code}`);
    const joined = await waitFor(async () => (await menuLabel(guest)) === `Room ${code} (2)`, 45000);
    check(joined, 'the friend joins from the invite link', await menuLabel(guest));
    check((await cloud(guest))['☁ score'] === 5, 'the friend gets the project with its cloud variable',
        await cloud(guest));
    check(await waitFor(async () => (await menuLabel(host)) === `Room ${code} (2)`),
        'the host sees two players');

    // --- cloud variables go both ways -----------------------------------------
    await guest.evaluate(() => {
        window.flagStarts = 0;
        window.vm.runtime.on('PROJECT_START', () => window.flagStarts++);
    });
    await host.evaluate(() => {
        const stage = window.vm.runtime.getTargetForStage();
        window.vm.setVariableValue(stage.id, 'score', 42);
    });
    check(await waitFor(async () => (await cloud(guest))['☁ score'] === 42, 5000),
        'a change on the host reaches the friend');
    await guest.evaluate(() => {
        const stage = window.vm.runtime.getTargetForStage();
        window.vm.setVariableValue(stage.id, 'score', 'from the friend');
    });
    check(await waitFor(async () => (await cloud(host))['☁ score'] === 'from the friend', 5000),
        'a change on the friend reaches the host');
    await guest.evaluate(() => {
        const stage = window.vm.runtime.getTargetForStage();
        window.vm.setVariableValue(stage.id, 'score', true);
    });
    check(await waitFor(async () => (await cloud(host))['☁ score'] === 'true', 5000),
        'a true/false value arrives as the text Scratch shows');

    // --- the host's green flag starts everyone --------------------------------
    await host.evaluate(() => {
        window.vm.greenFlag();
        window.vm.stopAll();
    });
    check(await waitFor(() => guest.evaluate(() => window.flagStarts === 1), 5000),
        'the host\'s green flag starts the friend\'s project');

    // --- chat ------------------------------------------------------------------
    await host.evaluate(() => {
        const input = [...document.querySelectorAll('[class*=rooms-panel_body] input[type=text]')].pop();
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        set.call(input, 'hello there');
        input.dispatchEvent(new Event('input', {bubbles: true}));
    });
    await clickButton(host, 'Send');
    await guest.evaluate(() => {
        [...document.querySelectorAll('[class*=menu-bar_menu-bar-item]')]
            .find(e => /^Room /.test(e.textContent.trim()))
            .click();
    });
    check(await waitFor(() => guest.evaluate(() => {
        const chat = document.querySelector('[class*=rooms-panel_chat]');
        return chat && /: hello there/.test(chat.innerText);
    }), 5000), 'chat from the host reaches the friend');
    await shot(guest, 'rooms-guest');

    // --- sending a changed project, twice at once -----------------------------
    await host.evaluate(() => {
        const stage = window.vm.runtime.getTargetForStage();
        stage.createVariable('level', '☁ level', '', true);
        stage.variables.level.value = 3;
    });
    await clickButton(host, 'Send the project again');
    await clickButton(host, 'Send the project again');
    check(await waitFor(async () => (await cloud(guest))['☁ level'] === 3, 15000),
        'sending the project twice in a row still arrives whole', await cloud(guest));
    check(await waitFor(async () => (await menuLabel(guest)) === `Room ${code} (2)`, 5000),
        'the friend is still in the room after the re-send');

    // --- the host closes the room ---------------------------------------------
    await clickButton(host, 'Close room');
    const closed = await waitFor(() => guest.evaluate(() => {
        const e = document.querySelector('[class*=rooms-panel_error]');
        return e && e.textContent;
    }), 10000);
    check(closed === 'The host closed the room.', 'the friend is told the host closed the room', closed);
    check(!(await guest.evaluate(() => location.search)).includes('room='),
        'the room code leaves the friend\'s address, so reloading does not rejoin');
    check(await guest.evaluate(() => window.vm.runtime.ioDevices.cloud.provider === null),
        'the friend\'s cloud variables are let go');

    // --- a code nobody is hosting ---------------------------------------------
    await guest.goto(`${SITE}/?room=ZZZZ9`);
    const nobody = await waitFor(() => guest.evaluate(() => {
        const e = document.querySelector('[class*=rooms-panel_error]');
        return e && e.textContent;
    }), 40000);
    check(!!nobody && /ZZZZ9/.test(nobody), 'joining a code nobody hosts says so', nobody);
} catch (e) {
    failures++;
    console.log(`FAIL ${e.stack || e}`);
} finally {
    await browser.close();
}

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
