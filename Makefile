.PHONY: install dev build up clean lint format

# Variables
FRONTEND_DIR = frontend
BACKEND_DIR = backend

install:
	@echo "Installing frontend dependencies..."
	cd $(FRONTEND_DIR) && npm install
	@echo "Installing backend dependencies..."
	cd $(BACKEND_DIR) && pip install -r requirements.txt

dev:
	@echo "Starting backend and frontend in development mode..."
	# Use standard terminal tools or foreman for running both, or run manually.
	@echo "Run 'cd frontend && npm run dev' and 'cd backend && uvicorn main:app --reload' in separate terminals."

build:
	@echo "Building docker images..."
	docker-compose build

up:
	@echo "Starting services with Docker Compose..."
	docker-compose up -d

down:
	@echo "Stopping services..."
	docker-compose down

clean: down
	@echo "Cleaning up temp files and node_modules..."
	rm -rf $(FRONTEND_DIR)/node_modules
	rm -rf $(FRONTEND_DIR)/.next
	rm -rf $(BACKEND_DIR)/__pycache__
	rm -rf $(BACKEND_DIR)/temp_papers/*
	rm -rf $(BACKEND_DIR)/data/*

lint:
	@echo "Linting backend Python code..."
	cd $(BACKEND_DIR) && ruff check .
	@echo "Linting frontend code..."
	cd $(FRONTEND_DIR) && npm run lint

format:
	@echo "Formatting backend Python code..."
	cd $(BACKEND_DIR) && ruff format .
