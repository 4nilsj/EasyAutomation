import os
import shutil

# Function to create a directory if it doesn't exist
def create_directory(directory):
    if not os.path.exists(directory):
        os.makedirs(directory)

# Function to organize files in the current directory
def organize_files():
    # Get a list of all files in the current directory
    current_directory = os.getcwd()
    files = [f for f in os.listdir(current_directory) if os.path.isfile(f)]

    # Create directories for each file extension and move files into them
    for file in files:
        file_extension = os.path.splitext(file)[1]
        if file_extension:
            # Remove the dot (.) from the file extension
            file_extension = file_extension[1:]
            create_directory(file_extension)  # Create a directory for the extension
            new_path = os.path.join(current_directory, file_extension, file)
            shutil.move(file, new_path)  # Move the file to the appropriate directory

if __name__ == "__main__":
    organize_files()
    print("Files organized successfully.")
