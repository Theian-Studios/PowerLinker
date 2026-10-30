import pytest
from fastapi.testclient import TestClient

from backend.mock import store as store_module
from backend.mock import voters as voters_module
from backend.mock.server import app, store
from backend.mock.voters import COOKIE_MAX_AGE, COOKIE_NAME, new_cookie_value, read_cookie_value, trust


@pytest.fixture(autouse=True)
def reset_store():
    store.reset()
    yield
    store.reset()


@pytest.fixture
def client():
    return TestClient(app)


def new_voter() -> TestClient:
    """A separate browser, with its own voter cookie."""
    return TestClient(app)


def vote_item(url: str, vote: int, sid: str = "sid") -> dict:
    return {
        "hint": {"id1": "ark", "id2": "pid", "recordType": "record_attachment", "origin": "Mock", "url": url},
        "vote": {"sid": sid, "vote": vote},
    }


def answer_dummies(voter: TestClient, right: int, wrong: int = 0) -> None:
    """Has a voter answer dummy hints, building up (or losing) trust."""
    for _ in range(right):
        dummy = voter.get("/hints", params={"dummy": True, "correct": True}).json()
        voter.put("/hints", json=[vote_item(dummy["url"], 1)])
    for _ in range(wrong):
        dummy = voter.get("/hints", params={"dummy": True, "correct": True}).json()
        voter.put("/hints", json=[vote_item(dummy["url"], -1)])


def voter_id(voter: TestClient) -> str:
    voter.get("/mock/state")
    return read_cookie_value(voter.cookies.get(COOKIE_NAME))


def pool_votes(client: TestClient, url: str) -> list[dict]:
    return next(hint for hint in client.get("/mock/state").json()["pool"] if hint["url"] == url)["votes"]


class TestVoterCookie:
    def test_new_visitor_gets_signed_cookie(self, client):
        response = client.get("/hints")

        set_cookie = response.headers["set-cookie"]
        assert f"Max-Age={COOKIE_MAX_AGE}" in set_cookie
        assert "HttpOnly" in set_cookie
        assert "SameSite=lax" in set_cookie
        assert read_cookie_value(client.cookies.get(COOKIE_NAME)) is not None

    def test_cookie_kept_and_renewed_on_later_visits(self, client):
        client.get("/hints")
        first = client.cookies.get(COOKIE_NAME)

        response = client.get("/hints")

        assert client.cookies.get(COOKIE_NAME) == first
        assert f"Max-Age={COOKIE_MAX_AGE}" in response.headers["set-cookie"]

    def test_tampered_cookie_replaced(self, client):
        voter, value = new_cookie_value()
        tampered = value[:-1] + ("0" if value[-1] != "0" else "1")

        response = client.get("/hints", headers={"cookie": f"{COOKIE_NAME}={tampered}"})

        new_value = response.cookies.get(COOKIE_NAME)
        assert new_value != tampered
        assert read_cookie_value(new_value) not in (None, voter)

    def test_preflight_gets_no_cookie(self, client):
        response = client.options(
            "/hints",
            headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "PUT"},
        )

        assert response.status_code == 200
        assert "set-cookie" not in response.headers

    def test_requests_without_votes_create_no_voter(self, client):
        client.get("/hints")
        client.get("/hints", params={"dummy": True})
        client.options("/hints", headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "PUT"})

        assert client.get("/mock/state").json()["voters"] == {}


class TestGetHints:
    def test_returns_count_hints_without_votes(self, client):
        hints = client.get("/hints", params={"count": 5}).json()

        assert len(hints) == 5
        for hint in hints:
            assert hint["url"].startswith("mock://hint/")
            assert hint["recordInfo"]["ark"].startswith("MOCK-ARK-")
            assert "votes" not in hint
            assert "expected" not in hint

    def test_pages_by_insert_time(self, client):
        hints = client.get("/hints", params={"count": 10, "last_insert_time": 25}).json()

        assert sorted(hint["insert-time"] for hint in hints) == [26, 27, 28, 29]

    def test_dummy_hint_includes_its_answer(self, client):
        dummy = client.get("/hints", params={"dummy": True, "correct": True}).json()

        assert dummy["expected"] == 1
        assert dummy["url"].startswith("mock://dummy/")


class TestDummyGrading:
    def test_new_voter_starts_at_low_trust(self, client):
        client.put("/hints", json=[vote_item("mock://hint/1", 1)])

        voters = client.get("/mock/state").json()["voters"]
        assert voters[voter_id(client)] == {"answered": 0, "correct": 0, "weight": 0.5}
        assert pool_votes(client, "mock://hint/1")[0]["weight"] == 0.5

    def test_correct_and_wrong_answers_tracked(self, client):
        answer_dummies(client, right=3, wrong=1)

        record = client.get("/mock/state").json()["voters"][voter_id(client)]
        assert (record["answered"], record["correct"]) == (4, 3)
        assert record["weight"] == round(trust(3, 4), 2)

    def test_only_first_answer_on_a_dummy_counts(self, client):
        dummy = client.get("/hints", params={"dummy": True, "correct": True}).json()
        client.put("/hints", json=[vote_item(dummy["url"], -1)])
        client.put("/hints", json=[vote_item(dummy["url"], 1)])

        record = client.get("/mock/state").json()["voters"][voter_id(client)]
        assert (record["answered"], record["correct"]) == (1, 0)

    def test_dummy_votes_not_added_to_pool(self, client):
        answer_dummies(client, right=2)

        state = client.get("/mock/state").json()
        assert state["voters"][voter_id(client)]["answered"] == 2
        assert all(hint["votes"] == [] for hint in state["pool"])

    def test_old_dummies_forgotten_past_cap(self, client, monkeypatch):
        monkeypatch.setattr(store_module, "MAX_DUMMIES", 2)
        first = client.get("/hints", params={"dummy": True, "correct": True}).json()
        client.get("/hints", params={"dummy": True})
        client.get("/hints", params={"dummy": True})

        assert len(store.dummies) == 2
        client.put("/hints", json=[vote_item(first["url"], 1)])
        assert client.get("/mock/state").json()["voters"][voter_id(client)]["answered"] == 0


class TestWeightedVotes:
    def test_trusted_voters_attach(self):
        voters = [new_voter() for _ in range(4)]
        for voter in voters:
            answer_dummies(voter, right=8)  # weight 0.9
        for voter in voters:
            voter.put("/hints", json=[vote_item("mock://hint/1", 1)])

        settled = voters[0].get("/mock/state").json()["settled"]
        assert settled[0]["outcome"] == "ATTACH_ME"
        assert len(settled[0]["votes"]) == 4

    def test_trusted_voters_reject(self):
        voters = [new_voter() for _ in range(4)]
        for voter in voters:
            answer_dummies(voter, right=8)
        for voter in voters:
            voter.put("/hints", json=[vote_item("mock://hint/1", -1)])

        assert voters[0].get("/mock/state").json()["settled"][0]["outcome"] == "REJECTED"

    def test_three_new_voters_are_not_enough(self):
        for _ in range(3):
            new_voter().put("/hints", json=[vote_item("mock://hint/1", 1)])

        viewer = new_voter()
        assert viewer.get("/mock/state").json()["settled"] == []
        assert [vote["vote"] for vote in pool_votes(viewer, "mock://hint/1")] == [1, 1, 1]

    def test_weight_fixed_when_vote_cast(self, client):
        client.put("/hints", json=[vote_item("mock://hint/1", 1)])
        answer_dummies(client, right=8)

        assert pool_votes(client, "mock://hint/1")[0]["weight"] == 0.5

    def test_five_untrusted_matches_go_to_experts(self):
        for _ in range(5):
            new_voter().put("/hints", json=[vote_item("mock://hint/1", 1)])

        settled = new_voter().get("/mock/state").json()["settled"]
        assert settled[0]["outcome"] == "EXPERT"
        assert settled[0]["weighted_total"] == 2.5

    def test_three_skips_go_to_experts(self):
        for _ in range(3):
            new_voter().put("/hints", json=[vote_item("mock://hint/1", 0)])

        assert new_voter().get("/mock/state").json()["settled"][0]["outcome"] == "EXPERT"

    def test_one_voter_one_vote_even_with_new_sessions(self, client):
        url = "mock://hint/1"
        client.put("/hints", json=[vote_item(url, 1, sid="tab-1"), vote_item(url, 1, sid="tab-2"), vote_item(url, -1, sid="tab-3")])

        assert [(vote["sid"], vote["vote"]) for vote in pool_votes(client, url)] == [("tab-3", -1)]


class TestSubmitVotes:
    def test_empty_votes_rejected(self, client):
        assert client.put("/hints", json=[]).status_code == 400

    def test_bad_vote_is_skipped(self, client):
        response = client.put("/hints", json=[
            vote_item("mock://hint/999", 1),
            vote_item("mock://hint/1", 7),
            vote_item("mock://hint/2", 1),
        ])

        assert response.status_code == 200
        assert pool_votes(client, "mock://hint/1") == []
        assert [vote["vote"] for vote in pool_votes(client, "mock://hint/2")] == [1]

    def test_settled_hint_no_longer_served(self, client):
        url = "mock://hint/1"
        for _ in range(5):
            new_voter().put("/hints", json=[vote_item(url, 1)])

        hints = client.get("/hints", params={"count": 100}).json()
        assert url not in [hint["url"] for hint in hints]


class TestSession:
    def test_invalidate_records_sid(self, client):
        client.post("/session-invalidate", json={"sid": "bad-sid"})

        assert client.get("/mock/state").json()["invalid_sids"] == ["bad-sid"]

    def test_reset_restores_pool(self, client):
        for _ in range(5):
            new_voter().put("/hints", json=[vote_item("mock://hint/1", 1)])
        client.post("/mock/reset")

        state = client.get("/mock/state").json()
        assert len(state["pool"]) == 29
        assert state["settled"] == []


class TestProfileCode:
    @pytest.fixture(autouse=True)
    def vip_code(self, monkeypatch):
        # The repo is public, so the tests use a code of their own, never the real one
        monkeypatch.setattr(voters_module, "VIP_CODE", "TEST2026")

    def test_vip_code_marks_voter_and_their_votes(self, client):
        assert client.post("/profile/code", json={"code": "TEST2026"}).json() == {"accepted": True}
        client.put("/hints", json=[vote_item("mock://hint/1", 1)])

        state = client.get("/mock/state").json()
        assert state["voters"][voter_id(client)]["vip"] is True
        assert pool_votes(client, "mock://hint/1")[0]["vip"] is True

    def test_code_must_match_exactly(self, client):
        for code in ["test2026", "TEST 2026", "Test2026", "TEST2025", ""]:
            assert client.post("/profile/code", json={"code": code}).json() == {"accepted": False}

        assert client.get("/mock/state").json()["voters"] == {}

    def test_spaces_around_code_ignored(self, client):
        assert client.post("/profile/code", json={"code": "  TEST2026 "}).json() == {"accepted": True}

    def test_other_voters_not_vip(self, client):
        client.post("/profile/code", json={"code": "TEST2026"})
        other = new_voter()
        other.put("/hints", json=[vote_item("mock://hint/1", 1)])

        assert pool_votes(client, "mock://hint/1")[0]["vip"] is False

    def test_nothing_accepted_without_a_code_set(self, client, monkeypatch):
        monkeypatch.setattr(voters_module, "VIP_CODE", "")
        for code in ["", "TEST2026"]:
            assert client.post("/profile/code", json={"code": code}).json() == {"accepted": False}
