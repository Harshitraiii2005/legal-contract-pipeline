package handlers

import "testing"

func TestNormalizeEmail(t *testing.T) {
	cases := map[string]string{
		"Foo@Bar.com":     "foo@bar.com",
		"  spaced@x.com ": "spaced@x.com",
		"already@low.com": "already@low.com",
	}
	for in, want := range cases {
		if got := normalizeEmail(in); got != want {
			t.Errorf("normalizeEmail(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestEmailPattern(t *testing.T) {
	valid := []string{"a@b.com", "counsel@company.co.uk", "first.last+tag@example.io"}
	for _, e := range valid {
		if !emailPattern.MatchString(e) {
			t.Errorf("expected %q to be a valid email", e)
		}
	}

	invalid := []string{"", "not-an-email", "missing-domain@", "@missing-local.com", "spaces in@email.com"}
	for _, e := range invalid {
		if emailPattern.MatchString(e) {
			t.Errorf("expected %q to be rejected as an invalid email", e)
		}
	}
}

func TestMinPasswordLength(t *testing.T) {
	if minPasswordLength != 8 {
		t.Errorf("minPasswordLength = %d, want 8 (Register handler assumes this)", minPasswordLength)
	}
}
