"""Data coordinator for MuPiBox-NG."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
import logging
import time
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .api import MuPiBoxApiClient, MuPiBoxApiError
from .const import (
    AUTH_UPDATE_INTERVAL_SECONDS,
    DOMAIN,
    INFO_UPDATE_INTERVAL_SECONDS,
    LIBRARY_UPDATE_INTERVAL_SECONDS,
    METRICS_UPDATE_INTERVAL_SECONDS,
    PROVIDER_UPDATE_INTERVAL_SECONDS,
    UPDATE_INTERVAL,
)
from .search_events import (
    SEARCH_EVENT,
    SEARCH_EVENTS_CAPABILITY,
    SEARCH_EVENTS_INTERVAL_SECONDS,
    event_data,
    next_events,
)

_LOGGER = logging.getLogger(__name__)


@dataclass(slots=True)
class MuPiBoxData:
    """Combined state fetched from the MuPiBox API."""

    status: dict[str, Any] = field(default_factory=dict)
    system: dict[str, Any] = field(default_factory=dict)
    spotify: dict[str, Any] = field(default_factory=dict)
    mupihat: dict[str, Any] = field(default_factory=dict)
    providers: dict[str, Any] = field(default_factory=dict)
    output_targets: dict[str, Any] = field(default_factory=dict)
    metrics: dict[str, Any] = field(default_factory=dict)
    info: dict[str, Any] = field(default_factory=dict)
    auth: dict[str, Any] = field(default_factory=dict)
    library: list[dict[str, Any]] = field(default_factory=list)
    update: dict[str, Any] = field(default_factory=dict)
    sleep_timer: dict[str, Any] = field(default_factory=dict)


class MuPiBoxCoordinator(DataUpdateCoordinator[MuPiBoxData]):
    """Poll MuPiBox once and share the result with all entities."""

    def __init__(
        self,
        hass: HomeAssistant,
        entry: ConfigEntry,
        api: MuPiBoxApiClient,
    ) -> None:
        super().__init__(
            hass,
            _LOGGER,
            name=DOMAIN,
            config_entry=entry,
            update_interval=UPDATE_INTERVAL,
        )
        self.api = api
        self._is_v1 = entry.data.get("protocol") == "ha_v1"
        self._cached = MuPiBoxData()
        self._last_library = 0.0
        self._last_info = 0.0
        self._last_auth = 0.0
        self._last_providers = 0.0
        self._last_metrics = 0.0
        self._last_update_check = 0.0
        # the search pool's events (fork "wishes"): the id seen last, None until known. Kept in Home Assistant's
        # storage (.storage/mupibox_search_events_<entry>): after a restart of Home Assistant it goes on from there and
        # announces what happened meanwhile - only without a kept id (the very first start) it begins at "now".
        self._search_last_id: int | None = None
        self._last_search_check = 0.0
        self._search_store: Store | None = None

    async def _async_search_store(self) -> Store:
        """The storage of the id seen last; the kept id loaded the first time."""
        if self._search_store is None:
            entry_id = self.config_entry.entry_id if self.config_entry else "default"
            self._search_store = Store(self.hass, 1, f"{DOMAIN}_search_events_{entry_id}")
            try:
                kept = await self._search_store.async_load()
            except Exception:  # noqa: BLE001 - an unreadable file: begin at "now", as the first time
                _LOGGER.warning("Kept search pool position could not be read - starting from now")
                kept = None
            last = kept.get("last_id") if isinstance(kept, dict) else None
            if isinstance(last, int) and not isinstance(last, bool) and last >= 0:
                self._search_last_id = last
        return self._search_store

    async def _async_poll_search_events(self, info: dict[str, Any], now: float) -> None:
        """Fire one event per new entry of the box's search pool list.

        Only boxes that offer it (capability "search_events"); a failure is
        logged and tried again at the next round - it never fails the update.
        """
        if (
            not self._is_v1
            or SEARCH_EVENTS_CAPABILITY not in info.get("capabilities", [])
            or now - self._last_search_check < SEARCH_EVENTS_INTERVAL_SECONDS
        ):
            return
        self._last_search_check = now
        try:
            store = await self._async_search_store()
            before = self._search_last_id
            payload = await self.api.async_get_search_events(before or 0)
            events, self._search_last_id = next_events(payload, before)
            box_name = str(info.get("name") or (self.config_entry.title if self.config_entry else "MuPiBox"))
            entry_id = self.config_entry.entry_id if self.config_entry else ""
            for event in events:
                self.hass.bus.async_fire(SEARCH_EVENT, event_data(event, box_name, entry_id))
            # (kept after the events went out: a restart in between announces them once more rather than never)
            if self._search_last_id is not None and self._search_last_id != before:
                await store.async_save({"last_id": self._search_last_id})
        except MuPiBoxApiError as err:
            _LOGGER.debug("Search pool events unavailable: %s", err)
        except Exception:  # noqa: BLE001 - an addition must never fail the box's update
            _LOGGER.exception("Search pool events could not be handled")

    async def _async_update_data(self) -> MuPiBoxData:
        now = time.monotonic()
        try:
            status_task = self.api.async_get_status()
            system_task = self.api.async_get_system()
            spotify_task = self.api.async_get_spotify_status()
            mupihat_task = self.api.async_get_mupihat_status()
            status, system, spotify, mupihat = await asyncio.gather(
                status_task, system_task, spotify_task, mupihat_task
            )

            output_targets = self._cached.output_targets
            try:
                output_targets = await self.api.async_get_output_targets()
            except MuPiBoxApiError as err:
                _LOGGER.debug("Could not refresh optional output targets: %s", err)

            metrics = self._cached.metrics
            if not metrics or now - self._last_metrics >= METRICS_UPDATE_INTERVAL_SECONDS:
                try:
                    metrics = await self.api.async_get_system_metrics()
                    self._last_metrics = now
                except MuPiBoxApiError as err:
                    _LOGGER.debug("Could not refresh optional system metrics: %s", err)

            providers = self._cached.providers
            if not providers or now - self._last_providers >= PROVIDER_UPDATE_INTERVAL_SECONDS:
                try:
                    providers = await self.api.async_get_provider_status()
                    self._last_providers = now
                except MuPiBoxApiError as err:
                    _LOGGER.debug("Could not refresh optional provider status: %s", err)

            info = self._cached.info
            if not info or now - self._last_info >= INFO_UPDATE_INTERVAL_SECONDS:
                info = await self.api.async_get_info()
                self._last_info = now

            sleep_timer: dict[str, Any] = {}
            if self._is_v1 and "sleep_timer" in info.get("capabilities", []):
                try:
                    sleep_timer = await self.api.async_get_sleep_timer()
                except MuPiBoxApiError as err:
                    _LOGGER.warning("Could not read power-off timer: %s", err)

            auth = self._cached.auth
            if not auth or now - self._last_auth >= AUTH_UPDATE_INTERVAL_SECONDS:
                auth = await self.api.async_get_admin_auth()
                self._last_auth = now

            update = self._cached.update
            if (self._is_v1
                    and (not update or now - self._last_update_check >= 600)):
                try:
                    update = await self.api.async_get_update()
                    self._last_update_check = now
                except MuPiBoxApiError as err:
                    _LOGGER.debug("Update check unavailable: %s", err)
                    self._last_update_check = now

            library = self._cached.library
            if not library or now - self._last_library >= LIBRARY_UPDATE_INTERVAL_SECONDS:
                library = await self.api.async_get_library()
                self._last_library = now

            await self._async_poll_search_events(info, now)

        except MuPiBoxApiError as err:
            raise UpdateFailed(str(err)) from err

        self._cached = MuPiBoxData(
            status=status,
            system=system,
            spotify=spotify,
            mupihat=mupihat,
            providers=providers,
            output_targets=output_targets,
            metrics=metrics,
            info=info,
            auth=auth,
            library=library,
            update=update,
            sleep_timer=sleep_timer,
        )
        return self._cached

    async def async_refresh_library(self) -> None:
        """Force the library to be fetched on the next update."""
        self._last_library = 0.0
        await self.async_request_refresh()
