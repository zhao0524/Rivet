from rivet_api.errors import ApiError


class NullAssetStore:
    """Placeholder until image upload lands: no asset exists."""

    def exists(self, asset_id: str) -> bool:
        return False

    def read_bytes(self, asset_id: str) -> tuple[bytes, str]:
        raise ApiError("ASSET_NOT_FOUND", "No such asset", 404)
