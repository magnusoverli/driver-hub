<script lang="ts">
	let { size = 28 }: { size?: number } = $props();
</script>

<span class="logo" style:width="{size}px" style:height="{size}px" aria-hidden="true">
	<svg
		width={size * 0.57}
		height={size * 0.57}
		viewBox="0 0 16 16"
		fill="none"
		stroke="currentColor"
		stroke-width="1.8"
		stroke-linecap="round"
		stroke-linejoin="round"
	>
		<path d="M2.5 11.5 6 5l3.5 5L13.5 4" />
	</svg>
</span>

<style>
	.logo {
		display: inline-flex;
		flex: none;
		align-items: center;
		justify-content: center;
		border-radius: 32%;
		background: var(--accent);
		color: var(--accent-ink);
	}
</style>
