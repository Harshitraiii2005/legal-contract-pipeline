package services

import (
	"fmt"
	"io"
	"io/ioutil"
	"os"
	"path/filepath"

	"github.com/lexai/backend-go/config"
)

// Storage provides local file storage operations.
type Storage struct {
	Root string
}

// NewStorage creates a new storage service.
func NewStorage(cfg *config.Config) *Storage {
	return &Storage{Root: cfg.StorageRoot}
}

// Put writes data to the given storage key.
func (s *Storage) Put(data []byte, key string) error {
	fullPath := filepath.Join(s.Root, key)
	dir := filepath.Dir(fullPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("failed to create directory %s: %w", dir, err)
	}
	return ioutil.WriteFile(fullPath, data, 0644)
}

// Get returns a ReadCloser for the given storage key.
func (s *Storage) Get(key string) (io.ReadCloser, error) {
	fullPath := filepath.Join(s.Root, key)
	f, err := os.Open(fullPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("file not found: %s", key)
		}
		return nil, err
	}
	return f, nil
}

// Exists checks if a file exists at the given key.
func (s *Storage) Exists(key string) bool {
	fullPath := filepath.Join(s.Root, key)
	_, err := os.Stat(fullPath)
	return err == nil
}
