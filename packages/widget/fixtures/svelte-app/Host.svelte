<script lang="ts">
  import type { ToolCaller } from "../../src/controller.js";

  let { caller }: { caller: ToolCaller } = $props();
</script>

<!-- `caller` is an object: Svelte sets it as a DOM property because the element has a `caller` property. -->
<strumentario-page-widget {caller} validate-delay-ms="0"></strumentario-page-widget>
