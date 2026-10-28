// History 路由（vue-router 4）。页面仍由 App.vue 按路由名组合，不使用 router-view。
// /iters · /iters/:name · /reqs · /reqs/:id · /cases
import { createRouter, createWebHistory } from 'vue-router'

const view = { name: 'RouteMarker', render: () => null }
const APP_TITLE = 'SDLC 产物协作平台'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', redirect: '/iters', meta: { title: '迭代列表' } },
    { path: '/iters', name: 'iters', component: view, meta: { title: '迭代列表' } },
    { path: '/iters/:name', name: 'iter', component: view, meta: { title: '迭代' } },
    { path: '/reqs', name: 'reqs', component: view, meta: { title: '需求' } },
    { path: '/reqs/:id', name: 'req', component: view, meta: { title: '需求详情' } },
    { path: '/cases', name: 'cases', component: view, meta: { title: '测试用例' } },
    { path: '/:pathMatch(.*)*', name: 'fallback', redirect: '/iters', meta: { title: '迭代列表' } },
  ],
})

router.afterEach(to => {
  const page = to.meta.title || APP_TITLE
  const detail = to.params.name || to.params.id
  document.title = detail ? `${detail} · ${page} · ${APP_TITLE}` : `${page} · ${APP_TITLE}`
})

export default router
