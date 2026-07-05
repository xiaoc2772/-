package farm

import (
	"context"
	"errors"
	"testing"
)

func TestStoreReturnsUnavailableWithoutDatabase(t *testing.T) {
	store := NewStore(nil)
	if _, err := store.GetState(context.Background(), 1); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("expected ErrUnavailable from GetState, got %v", err)
	}
	if err := store.SaveState(context.Background(), StateRecord{UserID: 1, StateJSON: []byte(`{}`)}); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("expected ErrUnavailable from SaveState, got %v", err)
	}
	if _, err := store.ListDailyPurchases(context.Background(), 1, "2026-06-23"); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("expected ErrUnavailable from ListDailyPurchases, got %v", err)
	}
}
