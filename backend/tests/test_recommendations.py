"""Метрики схожести для коллаборативной фильтрации
(app/services/recommendations.py)."""
import math

from app.services.recommendations import cosine, jaccard


class TestJaccard:
    def test_two_empty_sets(self):
        assert jaccard(set(), set()) == 0.0

    def test_identical_sets(self):
        assert jaccard({"a", "b"}, {"a", "b"}) == 1.0

    def test_disjoint_sets(self):
        assert jaccard({"a"}, {"b"}) == 0.0

    def test_partial_overlap(self):
        # |пересечение|=1, |объединение|=3
        assert jaccard({"a", "b"}, {"b", "c"}) == 1 / 3

    def test_one_empty_one_not(self):
        assert jaccard(set(), {"a", "b"}) == 0.0


class TestCosine:
    def test_no_common_keys(self):
        assert cosine({"p1": 5.0}, {"p2": 4.0}) == 0.0

    def test_identical_vectors(self):
        v = {"p1": 3.0, "p2": 4.0}
        assert math.isclose(cosine(v, v), 1.0)

    def test_zero_vector(self):
        assert cosine({"p1": 0.0}, {"p1": 5.0}) == 0.0

    def test_known_value(self):
        # a=(3,4), b=(4,3) по общим ключам -> dot=24, |a|=|b|=5 -> 24/25
        a = {"p1": 3.0, "p2": 4.0}
        b = {"p1": 4.0, "p2": 3.0}
        assert math.isclose(cosine(a, b), 24 / 25)

    def test_empty_dicts(self):
        assert cosine({}, {}) == 0.0
