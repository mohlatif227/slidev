import { join } from 'node:path'
import { existsSync } from 'node:fs'
import type { Plugin } from 'vite'
import Vue from '@vitejs/plugin-vue'
import VueJsx from '@vitejs/plugin-vue-jsx'
import Icons from 'unplugin-icons/vite'
import IconsResolver from 'unplugin-icons/resolver'
import Components from 'unplugin-vue-components/vite'
import ServerRef from 'vite-plugin-vue-server-ref'
import { notNullish } from '@antfu/utils'
import type { ResolvedSlidevOptions, SlidevPluginOptions, SlidevServerOptions } from '../options'
import { loadDrawings, writeDrawings } from '../drawings'
import { createConfigPlugin } from './extendConfig'
import { createSlidesLoader } from './loaders'
import { createMonacoTypesLoader } from './monacoTransform'
import { createClientSetupPlugin } from './setupClient'
import { createMarkdownPlugin } from './markdown'
import { createFixPlugins } from './patchTransform'

const customElements = new Set([
  // katex
  'annotation',
  'math',
  'menclose',
  'mfrac',
  'mglyph',
  'mi',
  'mlabeledtr',
  'mn',
  'mo',
  'mover',
  'mpadded',
  'mphantom',
  'mroot',
  'mrow',
  'mspace',
  'msqrt',
  'mstyle',
  'msub',
  'msubsup',
  'msup',
  'mtable',
  'mtd',
  'mtext',
  'mtr',
  'munder',
  'munderover',
  'semantics',
])

export async function ViteSlidevPlugin(
  options: ResolvedSlidevOptions,
  pluginOptions: SlidevPluginOptions,
  serverOptions: SlidevServerOptions = {},
): Promise<Plugin[]> {
  const {
    vue: vueOptions = {},
    vuejsx: vuejsxOptions = {},
    components: componentsOptions = {},
    icons: iconsOptions = {},
    remoteAssets: remoteAssetsOptions = {},
    serverRef: serverRefOptions = {},
  } = pluginOptions

  const {
    mode,
    themeRoots,
    addonRoots,
    clientRoot,
    data: { config },
  } = options

  const VuePlugin = Vue({
    include: [/\.vue$/, /\.md$/],
    exclude: [],
    template: {
      compilerOptions: {
        isCustomElement(tag) {
          return customElements.has(tag)
        },
      },
      ...vueOptions?.template,
    },
    ...vueOptions,
  })

  const VueJsxPlugin = VueJsx(vuejsxOptions)

  const MarkdownPlugin = await createMarkdownPlugin(options, pluginOptions)

  const drawingData = await loadDrawings(options)

  const publicRoots = themeRoots.map(i => join(i, 'public')).filter(existsSync)

  const plugins = [
    MarkdownPlugin,
    VueJsxPlugin,
    VuePlugin,

    createSlidesLoader(options, pluginOptions, serverOptions, VuePlugin, MarkdownPlugin),

    Components({
      extensions: ['vue', 'md', 'js', 'ts', 'jsx', 'tsx'],

      dirs: [
        join(clientRoot, 'builtin'),
        join(clientRoot, 'components'),
        ...themeRoots.map(i => join(i, 'components')),
        ...addonRoots.map(i => join(i, 'components')),
        'src/components',
        'components',
      ],

      include: [/\.vue$/, /\.vue\?vue/, /\.vue\?v=/, /\.md$/],
      exclude: [],

      resolvers: [
        IconsResolver({
          prefix: '',
          customCollections: Object.keys(iconsOptions.customCollections || []),
        }),
      ],

      dts: false,

      ...componentsOptions,
    }),

    Icons({
      defaultClass: 'slidev-icon',
      autoInstall: true,
      ...iconsOptions,
    }),

    (config.remoteAssets === true || config.remoteAssets === mode)
      ? import('vite-plugin-remote-assets').then(r => r.default({
        rules: [
          ...r.DefaultRules,
          {
            match: /\b(https?:\/\/image.unsplash\.com.*?)(?=[`'")\]])/ig,
            ext: '.png',
          },
        ],
        resolveMode: id => id.endsWith('index.html') ? 'relative' : '@fs',
        awaitDownload: mode === 'build',
        ...remoteAssetsOptions,
      }))
      : null,

    ServerRef({
      debug: process.env.NODE_ENV === 'development',
      state: {
        sync: false,
        nav: {
          page: 0,
          clicks: 0,
        },
        drawings: drawingData,
        ...serverRefOptions.state,
      },
      onChanged(key, data, patch, timestamp) {
        serverRefOptions.onChanged && serverRefOptions.onChanged(key, data, patch, timestamp)
        if (!options.data.config.drawings.persist)
          return
        if (key === 'drawings')
          writeDrawings(options, patch ?? data)
      },
    }),

    createConfigPlugin(options),
    createClientSetupPlugin(options),
    createMonacoTypesLoader(),
    createFixPlugins(options),

    publicRoots.length
      ? import('vite-plugin-static-copy').then(r => r.viteStaticCopy({
        silent: true,
        targets: publicRoots.map(r => ({
          src: `${r}/*`,
          dest: 'theme',
        })),
      }))
      : null,
    options.inspect
      ? import('vite-plugin-inspect').then(r => r.default({
        dev: true,
        build: true,
      }))
      : null,

    config.css === 'none'
      ? null
      : config.css === 'windicss'
        ? import('./windicss').then(r => r.createWindiCSSPlugin(options, pluginOptions))
        : import('./unocss').then(r => r.createUnocssPlugin(options, pluginOptions)),
  ]

  return (await Promise.all(plugins))
    .flat()
    .filter(notNullish)
}
