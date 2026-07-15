function Trading() {

	  return (
		      <div className="trade-box">

		        <div className="card">

		          <h2 style={{ marginBottom: '25px' }}>
		            Place Order
		          </h2>

		          <div className="input-group">

		            <label>Stock Symbol</label>

		            <input placeholder="AAPL" />

		          </div>

		          <div className="input-group">

		            <label>Quantity</label>

		            <input placeholder="10" />

		          </div>

		          <button className="buy-btn">
		            BUY STOCK
		          </button>

		        </div>

		      </div>
		    );
}

export default Trading;
