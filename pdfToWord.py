from pdf2docx import Converter

pdf_file = input("Enter the path to the PDF file: ")
docx_file = input("Enter the path for the output Word file: ")

cv = Converter(pdf_file)
cv.convert(docx_file, start=0, end=None)
cv.close()

print(f'PDF data from {pdf_file} has been converted to {docx_file}')
