<script lang="ts">
	// Render the release author's headings, paragraphs, lists, emphasis and code
	// with native Hub typography. No HTML injection, remote media or navigation.
	let { text }: { text: string } = $props();
	function parse(raw: string) {
		const blocks: { kind: 'title' | 'list' | 'paragraph' | 'code'; lines: string[] }[] = [];
		let fenced = false;
		let group: (typeof blocks)[number] | undefined;
		for (const line of raw.replace(/\r/g, '').split('\n')) {
			if (line.trimStart().startsWith('```')) {
				fenced = !fenced;
				group = undefined;
				continue;
			}
			const s = line.trim();
			if (!s && !fenced) {
				group = undefined;
				continue;
			}
			const kind = fenced
				? 'code'
				: /^#{1,6} /.test(s)
					? 'title'
					: /^[-*+] /.test(s)
						? 'list'
						: 'paragraph';
			if (!group || group.kind !== kind || kind === 'title') {
				group = { kind, lines: [] };
				blocks.push(group);
			}
			group.lines.push(
				fenced ? line : s.replace(/^(?:#{1,6}|[-*+]) /, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
			);
		}
		return blocks;
	}
</script>

{#snippet inline(line: string)}
	{#each line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g) as part, i (i)}
		{#if part.startsWith('**') && part.endsWith('**')}<strong>
				{part.slice(2, -2)}
			</strong>{:else if part.startsWith('`') && part.endsWith('`')}<code>
				{part.slice(1, -1)}
			</code>{:else}{part}{/if}
	{/each}
{/snippet}
<div class="notes">
	{#each parse(text) as block, i (i)}
		{#if block.kind === 'title'}<h3>{@render inline(block.lines[0])}</h3>
		{:else if block.kind === 'list'}<ul>
				{#each block.lines as line, j (j)}<li>{@render inline(line)}</li>{/each}
			</ul>
		{:else if block.kind === 'code'}<pre>{block.lines.join('\n')}</pre>
		{:else}<p>{@render inline(block.lines.join(' '))}</p>{/if}
	{/each}
</div>

<style>
	.notes {
		display: grid;
		gap: var(--space-3);
		max-height: 45vh;
		overflow: auto;
		overflow-wrap: anywhere;
		line-height: 1.55;
	}
	.notes ul {
		padding-inline-start: var(--space-5);
		list-style: disc;
	}
	.notes pre {
		overflow: auto;
	}
</style>
