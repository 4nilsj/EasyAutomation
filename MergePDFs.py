import fitz  # PyMuPDF
import os

def merge_pdfs(input_dir, output_file):
    pdf_merger = fitz.open()

    # Get all PDF files in the input directory
    pdf_files = [f for f in os.listdir(input_dir) if f.endswith('.pdf')]

    # Sort the files to merge them in order
    pdf_files.sort()

    for pdf_file in pdf_files:
        file_path = os.path.join(input_dir, pdf_file)
        pdf_document = fitz.open(file_path)
        pdf_merger.insert_pdf(pdf_document)

    # Write the merged PDF to the output file
    pdf_merger.save(output_file)
    pdf_merger.close()

if __name__ == "__main__":
    # Replace 'input_directory' and 'output_file' with your desired paths
    input_directory = 'D:/Personal Documents/Family docs/Shiva'
    output_file = 'D:/Personal Documents/Family docs/Shiva/output.pdf'

    merge_pdfs(input_directory, output_file)
