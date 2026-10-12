import js from '@eslint/js'
import pluginVue from 'eslint-plugin-vue'

// essential 档起步（错误级规则：v-for key / 重复属性 / 模板错误等），格式类规则不启——
// 存量 4000 行无 lint 历史，recommended 的风格面留给后续渐进收紧
export default [
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...pluginVue.configs['flat/essential'],
  {
    rules: {
      // 存量单词组件名（Chat/Dropdown 等）保留，不与任何 HTML 内建元素冲突
      'vue/multi-word-component-names': 'off'
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        window: 'readonly', document: 'readonly', location: 'readonly', history: 'readonly',
        localStorage: 'readonly', fetch: 'readonly', requestAnimationFrame: 'readonly',
        innerHeight: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly',
        setInterval: 'readonly', clearInterval: 'readonly', URL: 'readonly', console: 'readonly'
      }
    }
  }
]
