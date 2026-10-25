"""Read-only showcase catalogue loaded at startup from the packaged mirror of `fixtures/showcase/`.

`index.json` is the gallery, `products/*.json` the full records and `offers/*.json` the
pre-collected `OfferSet` per part (direct vendors only, keyed by the query's normalised key).
Every file is validated on load so a malformed fixture fails at startup, not on a request.
"""

import json
from pathlib import Path

from rivet_api.errors import ApiError
from rivet_api.offers.models import OfferSet
from rivet_api.showcase.models import ShowcaseIndex, ShowcasePart, ShowcaseProduct

FIXTURE_DIR = Path(__file__).resolve().parents[1] / "data" / "fixtures" / "showcase"
EMPTY_INDEX = ShowcaseIndex(schema_version="1.0", generated_at="1970-01-01T00:00:00Z", products=[])


class ShowcaseStore:
    def __init__(self, fixture_dir: Path = FIXTURE_DIR):
        self.fixture_dir = Path(fixture_dir)
        index_path = self.fixture_dir / "index.json"
        self.index = ShowcaseIndex.model_validate(json.loads(index_path.read_text())) if index_path.is_file() else EMPTY_INDEX
        self.products: dict[str, ShowcaseProduct] = {}
        for path in sorted((self.fixture_dir / "products").glob("*.json")):
            product = ShowcaseProduct.model_validate(json.loads(path.read_text()))
            self.products[product.product_id] = product
        self.offers_by_key: dict[str, OfferSet] = {}
        for path in sorted((self.fixture_dir / "offers").glob("*.json")):
            offer_set = OfferSet.model_validate(json.loads(path.read_text()))
            self.offers_by_key[offer_set.query.normalized_key] = offer_set

    def list(self, category: str | None = None) -> ShowcaseIndex:
        if category is None:
            return self.index
        return self.index.model_copy(update={"products": [p for p in self.index.products if p.category == category]})

    def product(self, product_id: str) -> ShowcaseProduct:
        found = self.products.get(product_id)
        if found is None:
            raise ApiError("SHOWCASE_NOT_FOUND", "No such showcase product", 404, {"product_id": product_id})
        return found

    def part(self, product_id: str, part_id: str) -> tuple[ShowcaseProduct, ShowcasePart]:
        product = self.product(product_id)
        part = product.part(part_id)
        if part is None:
            raise ApiError("PART_NOT_FOUND", "No such part in this showcase product", 404, {"product_id": product_id, "part_id": part_id})
        return product, part

    def precollected(self, normalized_key: str) -> OfferSet | None:
        return self.offers_by_key.get(normalized_key)
