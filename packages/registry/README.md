# vreen-registry

零外部依赖的 .vreen 包注册中心 + 发布 CLI。

## 文件

| 文件 | 作用 |
| --- | --- |
| `server.mjs` | HTTP 服务（discovery / download / publish） |
| `publish.mjs` | 直接操作 store 的 CLI |
| `schema.json` | `RegistryIndex` JSON Schema (draft-07) |
| `example-index.json` | 示例索引 |
| `test-server.mjs` | `server.mjs` 单元测试（`node --test`） |
| `test-publish.mjs` | `publish.mjs` 单元测试（`node --test`） |

## 存储布局

```
<store>/
  index.json                 # RegistryIndex
  packages/
    <id>/
      <version>/
        <id>.vreen           # 完整包
        <id>.vreen-delta     # 增量包(可选)
```

默认 `<store>` 为 `packages/registry/store`,可通过 `--store` 或 `VREEN_REGISTRY_STORE` 覆盖。

## 启动 server

```bash
# 默认 :8080
node packages/registry/server.mjs

# 自定义端口 + 启用 publish
VREEN_REGISTRY_TOKEN=secret node packages/registry/server.mjs --port 9000
```

环境变量:

| 变量 | 默认 | 作用 |
| --- | --- | --- |
| `VREEN_REGISTRY_PORT` | `8080` | 监听端口 |
| `VREEN_REGISTRY_STORE` | `./store` | 存储根目录 |
| `VREEN_REGISTRY_TOKEN` | _unset_ | 设置后启用 `POST /publish` |
| `VREEN_REGISTRY_BASE_URL` | _empty_ | 写入 `index.json` 的 `downloadUrl` 前缀 |

### 端点

| Method | Path | 说明 |
| --- | --- | --- |
| GET | `/` | HTML 索引（列出所有包 + 链接） |
| GET | `/health` | `200 ok` |
| GET | `/registry/index.json` | `RegistryIndex` JSON |
| GET | `/packages/<id>/<version>/<file>` | 下载 `.vreen` 或 `.vreen-delta` |
| GET | `/packages/<id>/<version>/` | 目录列表（调试） |
| POST | `/publish?token=...&id=...&version=...&kind=vreen\|delta` | 上传包 |

`POST /publish` 请求体为包原始字节(`.vreen` / `.vreen-delta`)。

## CLI (publish)

```bash
# 添加
node packages/registry/publish.mjs add robot.glb 1.0.0 ./out/robot.glb.vreen \
    --name "Robot Character" --tag character --tag robot --store ./store

# 查看
node packages/registry/publish.mjs list --store ./store
node packages/registry/publish.mjs list --tag character --store ./store
node packages/registry/publish.mjs info robot.glb --store ./store

# yank / unyank
node packages/registry/publish.mjs yank   robot.glb 1.0.0 --reason "broken" --store ./store
node packages/registry/publish.mjs unyank robot.glb 1.0.0 --store ./store

# 删除版本 / 整包
node packages/registry/publish.mjs remove robot.glb 1.0.0 --store ./store
node packages/registry/publish.mjs delete robot.glb        --store ./store

# 校验 sha256
node packages/registry/publish.mjs verify robot.glb 1.0.0 --store ./store
```

### 退出码

| 码 | 含义 |
| --- | --- |
| `0` | 成功 |
| `1` | 一般错误 (bad id/version/sha256 mismatch/...) |
| `2` | 参数错误 (未知子命令 / 缺参 / `--help`) |

## 协议摘要

### `RegistryIndex` (`index.json`)

```jsonc
{
  "version": "1.0.0",
  "generatedAt": "2026-07-15T19:00:00.000Z",
  "baseUrl": "https://registry.example.com",
  "packages": [
    {
      "id": "robot.glb",
      "name": "Robot Character",
      "description": "Hero mech for stage 1",
      "tags": ["character", "robot"],
      "author": "vreen-team",
      "license": "MIT",
      "homepage": "https://vreen.dev",
      "icon": "https://...",
      "latest": "1.2.0",
      "versions": [
        {
          "version": "1.2.0",
          "releasedAt": "2026-07-10T08:00:00.000Z",
          "downloadUrl": "/packages/robot.glb/1.2.0/robot.glb.vreen",
          "deltaUrl":    "/packages/robot.glb/1.2.0/robot.glb.vreen-delta",
          "size": 4194304,
          "sha256": "abc123...",
          "formatVersion": "0.2.1",
          "engineVersions": ["^0.2.0"],
          "dependencies": { "hdri.studio": "^1.0.0" },
          "yanked": false,
          "yankReason": null
        }
      ]
    }
  ]
}
```

完整 schema 见 `schema.json`。

### ID / 版本规则

- `id`: `^[a-z0-9][a-z0-9._-]{1,63}$` (小写字母/数字/`.`/`_`/`-`,2-64 字符)
- `version`: 严格 semver,可带 `-<pre>` 后缀

### 安全

- 所有包路径在 `servePackageFile` 中通过 `safeJoin()` 校验,防止 `..` 跳出 store。
- `POST /publish` 需要 `VREEN_REGISTRY_TOKEN`;缺失 token 时该接口返回 `503`。
- 客户端在下载后必须用 `sha256` 校验;`vreen-publish verify` 提供 CLI 实现。
- 单次 payload 上限 256 MB (`readBody` 默认 `max`);超出抛 `payload too large` → `500`。

## 测试

```bash
node --test packages/registry/test-server.mjs packages/registry/test-publish.mjs
```

应输出 `pass 24 / fail 0`。每个测试使用 `mkdtemp` 隔离临时 store,跑完即清理。

## 与其它包的关系

- `vreen-core` (Kotlin/Java) 提供 `VreenRegistry` 客户端,做 `loadRegistry` / `findPackage` / `resolveVersion` / `resolveDownloadUrl`。
- `vreen-publish` (Node) 和 registry server 都写同一份 store 布局,客户端可任意切换。
- `unity-package` / `unreal-plugin` 的导出器把 .vreen 文件 publish 到该 store,运行时通过 Unity / Unreal 的 registry client 拉取。

## 路线图

- [ ] 范围搜索 / 全文索引
- [ ] 按 tag 多选过滤 (`--tag a --tag b` AND)
- [ ] 签名包(Ed25519 manifest 签名)
- [ ] CDN 缓存头 (`cache-control: immutable`)
- [ ] 镜像 / replication
- [ ] WebSocket 实时索引推送
