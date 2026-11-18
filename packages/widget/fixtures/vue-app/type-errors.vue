<script setup lang="ts">
const notACaller = { call: 42 };
</script>

<template>
  <!-- Type-check proof: a caller that does not match the generated ToolCaller must be rejected. -->
  <!-- @vue-expect-error -->
  <strumentario-page-widget :caller.prop="notACaller" />
</template>
