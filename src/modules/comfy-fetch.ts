/**
 * ComfyUI 请求封装：浏览器直连 + SillyTavern 代理回退。
 *
 * 背景：ComfyUI 的 API 响应没有 CORS 头，浏览器跨域直连会被拦。
 * SillyTavern 服务端提供 /proxy/<完整URL> 转发端点（需 config.yaml
 * enableCorsProxy: true），同源转发绕开 CORS。
 *
 * 策略：先直连，失败（CORS/网络）后回退到 ST 代理。代理可用性
 * 由 isProxyAvailable 探测，避免每次请求都白试一次。
 */

let proxyAvailable: boolean | null = null;

/**
 * 探测 ST 代理是否可用。
 * 通过 /proxy 访问 ComfyUI 的 system_stats（轻量端点）验证。
 */
export async function probeProxy(comfyUrl: string): Promise<boolean> {
    if (proxyAvailable !== null) return proxyAvailable;
    try {
        const url = proxyUrl(comfyUrl, '/system_stats');
        const response = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(3000) });
        proxyAvailable = response.ok;
    } catch {
        proxyAvailable = false;
    }
    return proxyAvailable;
}

/** 重置代理可用性缓存（ComfyUI 地址变化时调用） */
export function resetProxyProbe(): void {
    proxyAvailable = null;
}

/** 构造 ST 代理 URL：/proxy/<完整URL> */
function proxyUrl(comfyUrl: string, path: string): string {
    return `/proxy/${comfyUrl.replace(/\/+$/, '')}${path}`;
}

/**
 * 请求 ComfyUI。直连优先，失败后回退代理。
 * @param comfyUrl ComfyUI 地址
 * @param path 路径（以 / 开头）
 * @param init fetch 选项（body 需为字符串）
 */
export async function comfyFetch(
    comfyUrl: string,
    path: string,
    init?: RequestInit,
): Promise<Response> {
    const directUrl = `${comfyUrl.replace(/\/+$/, '')}${path}`;

    // 直连
    try {
        const response = await fetch(directUrl, init);
        return response;
    } catch {
        // 直连失败（CORS / 网络）→ 走代理
    }

    // 回退：ST 代理
    const proxied = await fetch(proxyUrl(comfyUrl, path), init);
    return proxied;
}

/**
 * 生成图片的展示 URL。
 * 直连可用返回 ComfyUI 的 /view 地址，否则返回 ST 代理地址。
 */
export async function imageDisplayUrl(comfyUrl: string, image: { filename: string; type?: string; subfolder?: string }): Promise<string> {
    const params = new URLSearchParams({
        filename: image.filename,
        type: image.type ?? 'output',
    });
    if (image.subfolder) {
        params.set('subfolder', image.subfolder);
    }
    const query = params.toString();
    const base = comfyUrl.replace(/\/+$/, '');

    // 代理可用（或探测失败时保守走代理）则用代理 URL，保证图片一定能显示
    const useProxy = proxyAvailable ?? (await probeProxy(comfyUrl));
    return useProxy ? proxyUrl(comfyUrl, `/view?${query}`) : `${base}/view?${query}`;
}
