python -m venv venv
source venv/bin/activate
pip install -r requirements.txt

python scraper.py
python trainCreator.py

modal run .\train.py
modal run .\train.py --export-only


npm install
npm run dev