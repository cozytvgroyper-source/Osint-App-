"""HTTP client for the worldosint-headless API."""

from __future__ import annotations

import json

import httpx


class HeadlessClient:
    """Async HTTP client for the worldosint-headless /api/headless endpoint.

    The headless API expects:
      GET /api/headless?module=<id>&format=<fmt>&params=<json>
    where `params` is a JSON-encoded dict of module-specific parameters.
    """

    def __init__(self, base_url: str, timeout: float) -> None:
        self._base_url = base_url
        self._client = httpx.AsyncClient(base_url=base_url, timeout=timeout)
        self._timeout = timeout

    async def query_module(self, module_id: str, params: dict) -> dict:
        """Query a single module. Returns the module's data extracted from modules.<id>."""
        params = dict(params)  # don't mutate caller's dict
        fmt = params.pop("format", "json")
        module_params = {k: v for k, v in params.items() if v is not None}
        query = {"module": module_id, "format": fmt}
        if module_params:
            query["params"] = json.dumps(module_params)
        try:
            resp = await self._client.get("/api/headless", params=query)
            resp.raise_for_status()
            data = resp.json()
            return data.get("modules", {}).get(module_id, data)
        except httpx.ConnectError:
            return {"error": f"Headless server unreachable at {self._base_url}"}
        except httpx.TimeoutException:
            return {"error": f"Request timed out after {self._timeout}s", "module": module_id}
        except httpx.HTTPStatusError as exc:
            return {"error": f"HTTP {exc.response.status_code}", "detail": exc.response.text}

    async def query_modules(self, module_ids: list[str], params: dict) -> dict:
        """Query multiple modules. Returns {module_id: data} dict."""
        params = dict(params)  # don't mutate caller's dict
        fmt = params.pop("format", "json")
        module_params = {k: v for k, v in params.items() if v is not None}
        query = {"modules": ",".join(module_ids), "format": fmt}
        if module_params:
            query["params"] = json.dumps(module_params)
        try:
            resp = await self._client.get("/api/headless", params=query)
            resp.raise_for_status()
            data = resp.json()
            return data.get("modules", data)
        except httpx.ConnectError:
            return {"error": f"Headless server unreachable at {self._base_url}"}
        except httpx.TimeoutException:
            return {"error": f"Request timed out after {self._timeout}s", "modules": module_ids}
        except httpx.HTTPStatusError as exc:
            return {"error": f"HTTP {exc.response.status_code}", "detail": exc.response.text}

    async def list_modules(self) -> dict:
        """GET /api/headless?module=list — returns list of available modules."""
        try:
            resp = await self._client.get("/api/headless", params={"module": "list"})
            resp.raise_for_status()
            return resp.json()
        except httpx.ConnectError:
            return {"error": f"Headless server unreachable at {self._base_url}"}
        except httpx.TimeoutException:
            return {"error": f"Request timed out after {self._timeout}s"}
        except httpx.HTTPStatusError as exc:
            return {"error": f"HTTP {exc.response.status_code}", "detail": exc.response.text}

    async def health(self) -> dict:
        """GET /health — returns health status."""
        try:
            resp = await self._client.get("/health")
            resp.raise_for_status()
            return resp.json()
        except httpx.ConnectError:
            return {"error": f"Headless server unreachable at {self._base_url}"}
        except httpx.TimeoutException:
            return {"error": f"Request timed out after {self._timeout}s"}
        except httpx.HTTPStatusError as exc:
            return {"error": f"HTTP {exc.response.status_code}", "detail": exc.response.text}

    async def close(self) -> None:
        await self._client.aclose()
