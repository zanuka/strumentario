<script setup lang="ts">
import type { ToolCaller } from "../../src/controller.js";

// `caller` is an object: `.prop` sets the DOM property. As an attribute it would be stringified.
defineProps<{ caller: ToolCaller }>();
</script>

<template>
  <strumentario-page-widget :caller.prop="caller" validate-delay-ms="0" />
</template>
