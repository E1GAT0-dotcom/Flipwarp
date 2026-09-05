// Dialogue trees — Flipwarp
//
// A conversation is a shape: someone says something, you pick from two or
// three replies, and each reply leads somewhere else. Built out of ordinary
// blocks that shape becomes a hundred nested ifs, one per line of dialogue,
// and adding a sentence in the middle means renumbering everything after it.
//
// Here the conversation is written down as text and walked through with a
// handful of blocks. The text looks like this:
//
//     start: The gate is shut.
//       -> Knock. : knock
//       -> Leave. : end
//     knock: Nobody answers.
//       -> Knock again. : knock
//       -> Leave. : end
//     end: You walk away.
//
// A line ending in a colon starts a part and names it. A line beginning with
// -> is a reply: what the player sees, then a colon, then which part it leads
// to. Indentation is decoration — it reads better, and nothing depends on it.

(function (Scratch) {
    'use strict';

    /**
     * Turn the written conversation into parts that can be walked.
     * @param {string} text the conversation as written
     * @returns {object} parts by name, in order, and any complaints
     */
    const parse = text => {
        const parts = {};
        const order = [];
        const problems = [];
        let current = null;

        const lines = String(text).split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line || line.startsWith('//')) continue;

            if (line.startsWith('->')) {
                if (!current) {
                    problems.push(`line ${i + 1}: a reply before any part was named`);
                    continue;
                }
                const body = line.slice(2).trim();
                const split = body.lastIndexOf(':');
                if (split === -1) {
                    problems.push(`line ${i + 1}: a reply needs a colon and where it goes`);
                    continue;
                }
                current.replies.push({
                    text: body.slice(0, split).trim(),
                    goes: body.slice(split + 1).trim()
                });
                continue;
            }

            const split = line.indexOf(':');
            if (split === -1) {
                // A plain line continues what the last part was saying, so a
                // long speech can be written over several lines.
                if (current) current.says += (current.says ? '\n' : '') + line;
                else problems.push(`line ${i + 1}: this is not part of anything`);
                continue;
            }
            const name = line.slice(0, split).trim();
            if (!name) {
                problems.push(`line ${i + 1}: a part needs a name before its colon`);
                continue;
            }
            if (parts[name]) problems.push(`line ${i + 1}: there are two parts called ${name}`);
            current = {name, says: line.slice(split + 1).trim(), replies: []};
            parts[name] = current;
            order.push(name);
        }

        // A reply that leads nowhere is the mistake this catches best: it
        // looks fine until someone picks it during play.
        for (const name of order) {
            for (const reply of parts[name].replies) {
                if (!parts[reply.goes]) {
                    problems.push(`${name}: the reply "${reply.text}" leads to ${reply.goes}, ` +
                        `which is not a part`);
                }
            }
        }

        return {parts, order, problems};
    };

    class FlipwarpDialogue {
        constructor () {
            this.loaded = {parts: {}, order: [], problems: []};
            this.at = '';
        }

        getInfo () {
            return {
                id: 'flipwarpDialogue',
                name: 'Dialogue',
                color1: '#7a5bc4',
                color2: '#654aa6',
                blocks: [
                    {
                        opcode: 'use',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'use conversation [TEXT]',
                        arguments: {
                            TEXT: {
                                type: Scratch.ArgumentType.STRING,
                                defaultValue: 'start: Hello.\n  -> Hello back. : end\nend: Goodbye.'
                            }
                        }
                    },
                    {
                        opcode: 'goTo',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'go to part [NAME]',
                        arguments: {
                            NAME: {type: Scratch.ArgumentType.STRING, defaultValue: 'start'}
                        }
                    },
                    '---',
                    {
                        opcode: 'says',
                        blockType: Scratch.BlockType.REPORTER,
                        text: 'what is said here'
                    },
                    {
                        opcode: 'replyCount',
                        blockType: Scratch.BlockType.REPORTER,
                        text: 'number of replies'
                    },
                    {
                        opcode: 'reply',
                        blockType: Scratch.BlockType.REPORTER,
                        text: 'reply [N]',
                        arguments: {
                            N: {type: Scratch.ArgumentType.NUMBER, defaultValue: 1}
                        }
                    },
                    {
                        opcode: 'choose',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'choose reply [N]',
                        arguments: {
                            N: {type: Scratch.ArgumentType.NUMBER, defaultValue: 1}
                        }
                    },
                    '---',
                    {
                        opcode: 'here',
                        blockType: Scratch.BlockType.REPORTER,
                        text: 'part I am at'
                    },
                    {
                        opcode: 'isEnd',
                        blockType: Scratch.BlockType.BOOLEAN,
                        text: 'conversation over?'
                    },
                    {
                        opcode: 'partNames',
                        blockType: Scratch.BlockType.REPORTER,
                        text: 'all part names'
                    },
                    {
                        opcode: 'problems',
                        blockType: Scratch.BlockType.REPORTER,
                        text: 'problems with the conversation'
                    }
                ]
            };
        }

        use (args) {
            this.loaded = parse(Scratch.Cast.toString(args.TEXT));
            // Starting at the first part written means a conversation is
            // usable without a "go to" block, which is what most want.
            this.at = this.loaded.order.length ? this.loaded.order[0] : '';
        }

        goTo (args) {
            const name = Scratch.Cast.toString(args.NAME);
            if (this.loaded.parts[name]) this.at = name;
        }

        current () {
            return this.loaded.parts[this.at] || null;
        }

        says () {
            const part = this.current();
            return part ? part.says : '';
        }

        replyCount () {
            const part = this.current();
            return part ? part.replies.length : 0;
        }

        reply (args) {
            const part = this.current();
            if (!part) return '';
            // Counted from one, the way Scratch counts everything else.
            const chosen = part.replies[Scratch.Cast.toNumber(args.N) - 1];
            return chosen ? chosen.text : '';
        }

        choose (args) {
            const part = this.current();
            if (!part) return;
            const chosen = part.replies[Scratch.Cast.toNumber(args.N) - 1];
            if (chosen && this.loaded.parts[chosen.goes]) this.at = chosen.goes;
        }

        here () {
            return this.at;
        }

        isEnd () {
            const part = this.current();
            // Nowhere left to go: either the part has no replies, or there is
            // no part at all.
            return !part || part.replies.length === 0;
        }

        partNames () {
            return this.loaded.order.join(', ');
        }

        problems () {
            return this.loaded.problems.join('; ');
        }
    }

    Scratch.extensions.register(new FlipwarpDialogue());
}(Scratch));
